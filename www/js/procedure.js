// File    : procedure.js
// Desc    : 작업절차서 업로드·저장·검색·UI 관리 모듈 (IndexedDB + BM25)
// Date    : 2025-05-11
// Author  : SafeAI

const ProcedureManager = (() => {
  'use strict';

  const DB_NAME    = 'safeai-procedures';
  const DB_VERSION = 1;
  const STORE_NAME = 'procedures';

  let _db = null;

  // ── IndexedDB 초기화 ─────────────────────────────────────────────────────

  function _openDB() {
    return new Promise((resolve, reject) => {
      if (_db) { resolve(_db); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('registeredAt', 'registeredAt', { unique: false });
        }
      };
      req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror    = ()  => reject(new Error('IndexedDB 열기 실패'));
    });
  }

  async function _saveProc(proc) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(proc);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(new Error('저장 실패'));
    });
  }

  async function _listProcs() {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx   = db.transaction(STORE_NAME, 'readonly');
      const req  = tx.objectStore(STORE_NAME).index('registeredAt').getAll();
      req.onsuccess = (e) => resolve([...e.target.result].reverse());
      req.onerror   = () => reject(new Error('목록 조회 실패'));
    });
  }

  async function _deleteProc(id) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(new Error('삭제 실패'));
    });
  }

  // ── 파일 파싱 ─────────────────────────────────────────────────────────────

  // hwpx (ZIP) → section0.xml 내 <hp:t> 텍스트 추출
  async function _parseHwpx(file) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip 라이브러리가 없습니다.');
    const buf  = await file.arrayBuffer();
    const zip  = await JSZip.loadAsync(buf);

    // section0.xml 위치 탐색 (Contents/section0.xml 또는 하위 경로)
    let xmlEntry = zip.file('Contents/section0.xml');
    if (!xmlEntry) {
      const keys = Object.keys(zip.files);
      const key  = keys.find(k => /section\d+\.xml$/i.test(k));
      if (key) xmlEntry = zip.file(key);
    }
    if (!xmlEntry) throw new Error('hwpx 내 섹션 파일을 찾을 수 없습니다.');

    const xml   = await xmlEntry.async('string');
    // <hp:t> 태그 내 텍스트 수집
    const texts = [];
    let m;
    const re = /<hp:t[^>]*>([^<]*)<\/hp:t>/g;
    while ((m = re.exec(xml)) !== null) {
      const t = m[1].trim();
      if (t) texts.push(t);
    }
    return texts.join(' ');
  }

  // PDF / 이미지 → Claude Vision API 로 텍스트 추출
  async function _extractTextViaAI(base64, mediaType) {
    if (typeof ClaudeBridge === 'undefined') throw new Error('ClaudeBridge 없음');
    return new Promise((resolve, reject) => {
      let text     = '';
      let listener = null;
      listener = ClaudeBridge.addListener('onToken', ({ token, done, error }) => {
        if (error) { listener?.remove(); reject(new Error(error)); return; }
        if (done || token === null) { listener?.remove(); resolve(text); return; }
        text += token;
      });
      ClaudeBridge.generate({
        prompt:       '이 문서의 텍스트를 모두 추출해주세요. 제목, 작업 단계, 안전 주의사항 등 모든 내용을 그대로 추출하세요.',
        history:      [],
        imageBase64:  base64,
        imageMediaType: mediaType,
        maxTokens:    2048,
        language:     'ko',
        systemPrompt: '문서에서 텍스트를 추출합니다. 추출된 텍스트 내용만 출력하세요.'
      }).catch(err => { listener?.remove(); reject(err); });
    });
  }

  // 파일 → base64 변환
  function _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = (e) => resolve(e.target.result.split(',')[1]);
      reader.onerror = () => reject(new Error('파일 읽기 실패'));
      reader.readAsDataURL(file);
    });
  }

  // 파일 확장자 → mediaType
  function _mediaType(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };
    return map[ext] || 'application/octet-stream';
  }

  // 파일 파싱 → { fullText, method }
  async function _parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'hwpx') {
      const fullText = await _parseHwpx(file);
      return { fullText, method: 'hwpx' };
    }
    if (['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) {
      const base64    = await _fileToBase64(file);
      const mediaType = _mediaType(file.name);
      const fullText  = await _extractTextViaAI(base64, mediaType);
      return { fullText, method: 'vision' };
    }
    throw new Error(`지원하지 않는 파일 형식: .${ext}`);
  }

  // ── BM25 검색 ─────────────────────────────────────────────────────────────

  function _tokenize(text) {
    return (text || '').toLowerCase().match(/[가-힣a-z0-9]+/g) || [];
  }

  // @param query   검색 쿼리 문자열
  // @param procs   작업절차서 배열
  // @param topN    반환 개수
  // @return        score 내림차순 정렬된 {proc, score} 배열
  function _bm25(query, procs, topN = 3) {
    const k1 = 1.5, b = 0.75;
    const qTokens = _tokenize(query);
    if (!qTokens.length || !procs.length) return [];

    // 문서별 토큰화
    const docs = procs.map(p => _tokenize(p.fullText));
    const avgLen = docs.reduce((s, d) => s + d.length, 0) / docs.length;

    // IDF 계산
    const df = {};
    for (const doc of docs) {
      const seen = new Set(doc);
      for (const t of seen) df[t] = (df[t] || 0) + 1;
    }
    const N   = docs.length;
    const idf = (t) => Math.log((N - (df[t] || 0) + 0.5) / ((df[t] || 0) + 0.5) + 1);

    // 문서별 점수 계산
    const scored = procs.map((proc, i) => {
      const doc = docs[i];
      const tf  = {};
      for (const t of doc) tf[t] = (tf[t] || 0) + 1;
      const len  = doc.length;
      let score  = 0;
      for (const t of qTokens) {
        const freq = tf[t] || 0;
        score += idf(t) * (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * len / avgLen));
      }
      return { proc, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  // 외부 API: 쿼리로 절차서 검색
  // @param query 검색 텍스트 (STT 결과 등)
  // @param topN  최대 반환 수
  // @return      Promise<Array<{proc, score}>>
  async function search(query, topN = 3) {
    const procs = await _listProcs();
    return _bm25(query, procs, topN);
  }

  // ── 파일 업로드 처리 ──────────────────────────────────────────────────────

  // 단일 파일 업로드 + DB 저장
  // @param file      File 객체
  // @param onStatus  (msg) 진행 상태 콜백
  async function uploadFile(file, onStatus) {
    onStatus?.(`"${file.name}" 분석 중...`);
    const { fullText, method } = await _parseFile(file);
    if (!fullText || fullText.trim().length < 10) {
      throw new Error(`텍스트를 추출할 수 없습니다: ${file.name}`);
    }
    const proc = {
      id:           Date.now(),
      title:        file.name.replace(/\.[^.]+$/, ''),
      fileName:     file.name,
      fullText:     fullText.trim(),
      method,
      registeredAt: new Date().toISOString()
    };
    await _saveProc(proc);
    onStatus?.(`"${proc.title}" 등록 완료`);
    return proc;
  }

  // ── 절차서 화면 UI ────────────────────────────────────────────────────────

  // 절차서 목록 렌더링
  async function _renderList() {
    const listEl = document.getElementById('proc-list');
    if (!listEl) return;

    let procs;
    try { procs = await _listProcs(); } catch (e) {
      listEl.innerHTML = `<p class="proc-empty">목록 조회 오류: ${e.message}</p>`;
      return;
    }

    if (!procs.length) {
      listEl.innerHTML = '<p class="proc-empty">등록된 절차서가 없습니다.<br>파일을 업로드하세요.</p>';
      return;
    }

    listEl.innerHTML = procs.map(p => `
      <div class="proc-item" data-id="${p.id}">
        <div class="proc-item-info">
          <div class="proc-item-title">${_esc(p.title)}</div>
          <div class="proc-item-meta">
            ${p.fileName} · ${new Date(p.registeredAt).toLocaleDateString('ko-KR')}
          </div>
          <div class="proc-item-preview">${_esc(p.fullText.slice(0, 80))}...</div>
        </div>
        <button class="btn-proc-delete" data-id="${p.id}" aria-label="삭제">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14H6L5 6"></path>
            <path d="M10 11v6M14 11v6"></path>
            <path d="M9 6V4h6v2"></path>
          </svg>
        </button>
      </div>`).join('');

    // 삭제 버튼 이벤트
    listEl.querySelectorAll('.btn-proc-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        if (!confirm('이 절차서를 삭제할까요?')) return;
        try {
          await _deleteProc(id);
          await _renderList();
        } catch (err) {
          alert('삭제 실패: ' + err.message);
        }
      });
    });
  }

  // HTML 이스케이프
  function _esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 절차서 화면 진입 (app.js에서 호출)
  async function enter() {
    await _renderList();
    _bindUpload();
  }

  // 파일 업로드 바인딩
  function _bindUpload() {
    const input      = document.getElementById('proc-file-input');
    const progressEl = document.getElementById('proc-upload-progress');
    const progressTxt = document.getElementById('proc-upload-progress-text');

    if (!input || input._bound) return;
    input._bound = true;

    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      input.value = '';

      progressEl?.classList.remove('hidden');
      for (const file of files) {
        try {
          await uploadFile(file, (msg) => {
            if (progressTxt) progressTxt.textContent = msg;
          });
        } catch (err) {
          alert(`업로드 실패 (${file.name}):\n${err.message}`);
        }
      }
      progressEl?.classList.add('hidden');
      await _renderList();
    });
  }

  // 모듈 초기화 (앱 시작 시 한 번 호출)
  async function init() {
    try { await _openDB(); } catch (e) { console.error('[ProcedureManager] DB init error:', e); }
  }

  return { init, enter, search, uploadFile };
})();
