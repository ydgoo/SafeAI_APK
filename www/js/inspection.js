/**
 * inspection.js — 안전점검 화면 로직
 * 이미지/영상 업로드 → Claude AI 위험 분석 → 결과 출력
 */

const Inspection = (() => {

  // 점검 분야 → 시스템 프롬프트 추가 지시
  const CATEGORY_PROMPT = {
    general:      '산업 현장 전반',
    construction: '건설현장 (비계, 굴착, 고소작업, 중장비 등)',
    manufacturing:'제조업 (기계·설비, 협착, 끼임 위험 등)',
    chemical:     '화학물질·위험물 (누출, 보관, 취급 등)',
    electric:     '전기·설비 (감전, 절연, 접지, 배선 등)',
    fall:         '추락·낙하 방지 (안전난간, 개구부, 안전망 등)'
  };

  // ── 법령 해설 시스템 프롬프트 ──────────────────────────────────────
  const LAW_SYSTEM_PROMPT = `당신은 대한민국 산업안전보건법 및 중대재해처벌법 전문 해설가입니다.
점검 결과에서 식별된 위험요소에 관련 법령 조항이 어떻게 적용되는지 명확하고 실무적으로 해설하세요.
한국어로 답변하세요.`;

  let selectedCategory  = 'general';
  let attachedMedia     = null;   // CameraManager에서 받은 미디어 객체
  let isAnalyzing       = false;
  let tokenListener     = null;
  let _lawListener      = null;   // 법령 2차 호출 리스너 (enter 시 정리용)
  let _lastResultText   = '';     // PDF용 최종 점검 결과 텍스트
  let _lastLawText      = '';     // PDF용 최종 법령 해설 텍스트
  let _selectedProcedure = null;  // 안전점검에 활용할 선택된 작업절차서

  // ── 초기화 ─────────────────────────────────────────────────────────
  function init() {
    _bindCategoryChips();
    _bindUploadZone();
    _bindInspectButton();
    _bindStt();
    document.getElementById('btn-generate-report')?.addEventListener('click', _showReport);
    document.getElementById('btn-report-close')?.addEventListener('click', _hideReport);
    document.getElementById('btn-report-pdf')?.addEventListener('click', _exportPdf);
    document.getElementById('btn-proc-match-close')?.addEventListener('click', () => {
      document.getElementById('proc-match-area')?.classList.add('hidden');
    });
    document.getElementById('btn-deselect-proc')?.addEventListener('click', _clearProcedure);
  }

  // ── 카테고리 칩 ────────────────────────────────────────────────────
  function _bindCategoryChips() {
    document.getElementById('category-chips')?.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      selectedCategory = chip.dataset.value;
    });
  }

  // ── 업로드 영역 ────────────────────────────────────────────────────
  function _bindUploadZone() {
    const zone        = document.getElementById('upload-zone');
    const fileInput   = document.getElementById('file-input');
    const cameraInput = document.getElementById('camera-capture-input');

    // 미디어 준비 완료 콜백
    const _onMediaReady = (media, name = '') => {
      attachedMedia = media;
      _showPreview(media, name);
      _updateInspectButton();
    };

    // 영역 탭/클릭 → 파일 선택
    document.getElementById('upload-zone-inner')?.addEventListener('click', () => {
      if (!attachedMedia) fileInput?.click();
    });

    // 카메라 버튼 → capture="environment" input 직접 클릭 (Capacitor Camera 우회)
    document.getElementById('btn-upload-camera')?.addEventListener('click', e => {
      e.stopPropagation();
      if (cameraInput) {
        cameraInput.value = '';
        cameraInput.click();
      } else {
        fileInput?.click();
      }
    });

    // 파일 선택 버튼
    document.getElementById('btn-upload-file')?.addEventListener('click', e => {
      e.stopPropagation();
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
    });

    // 카메라 capture input 이벤트
    cameraInput?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      await CameraManager.handleFileSelect(file, media => _onMediaReady(media, '카메라'));
      e.target.value = '';
    });

    // 파일 선택 이벤트
    fileInput?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;

      // 동영상 1분 미만 검사
      if (file.type.startsWith('video/')) {
        const ok = await _checkVideoDuration(file);
        if (!ok) {
          alert('동영상은 1분(60초) 미만만 업로드 가능합니다.');
          e.target.value = '';
          return;
        }
      }

      await CameraManager.handleFileSelect(file, media => _onMediaReady(media, file.name));
      e.target.value = '';
    });

    // 미디어 제거
    document.getElementById('btn-remove-media')?.addEventListener('click', () => {
      CameraManager.hideAttachBar({ revokeBlob: true });
      attachedMedia = null;
      _hidePreview();
      _updateInspectButton();
    });

    // 드래그 & 드롭 (PC)
    zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone?.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone?.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files?.[0];
      if (file) {
        if (file.type.startsWith('video/')) {
          const ok = await _checkVideoDuration(file);
          if (!ok) { alert('동영상은 1분 미만만 가능합니다.'); return; }
        }
        await CameraManager.handleFileSelect(file);
        attachedMedia = CameraManager.getAttachedImage();
        _showPreview(attachedMedia, file.name);
        _updateInspectButton();
      }
    });
  }

  // 동영상 길이 체크 (60초 미만)
  function _checkVideoDuration(file) {
    return new Promise(resolve => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve(video.duration < 60);
      };
      video.onerror = () => { URL.revokeObjectURL(video.src); resolve(true); };
      video.src = URL.createObjectURL(file);
    });
  }

  // ── 미디어 미리보기 ────────────────────────────────────────────────
  function _showPreview(media, name) {
    const zone    = document.getElementById('upload-zone-inner');
    const preview = document.getElementById('media-preview');
    const img     = document.getElementById('preview-img');
    const video   = document.getElementById('preview-video');
    const badge   = document.getElementById('media-type-badge');
    const nameEl  = document.getElementById('media-preview-name');

    if (zone)    zone.classList.add('hidden');
    if (preview) preview.classList.remove('hidden');

    if (media?.isVideo) {
      img?.classList.add('hidden');
      if (video) { video.src = media.blobUrl; video.classList.remove('hidden'); }
      if (badge) badge.textContent = 'VIDEO';
    } else {
      video?.classList.add('hidden');
      if (img) { img.src = media.dataUrl; img.classList.remove('hidden'); }
      if (badge) badge.textContent = 'IMAGE';
    }
    if (nameEl) nameEl.textContent = name || '';
  }

  function _hidePreview() {
    document.getElementById('upload-zone-inner')?.classList.remove('hidden');
    document.getElementById('media-preview')?.classList.add('hidden');
    const img   = document.getElementById('preview-img');
    const video = document.getElementById('preview-video');
    if (img)   { img.src = ''; img.classList.add('hidden'); }
    if (video) { video.src = ''; video.classList.add('hidden'); }
  }

  // ── 점검하기 버튼 ──────────────────────────────────────────────────
  function _updateInspectButton() {
    const btn = document.getElementById('btn-inspect');
    if (btn) btn.disabled = !attachedMedia || isAnalyzing;
  }

  function _bindInspectButton() {
    document.getElementById('btn-inspect')?.addEventListener('click', () => {
      if (!attachedMedia || isAnalyzing) return;
      _startAnalysis();
    });
  }

  // ── STT (음성 입력) ────────────────────────────────────────────────
  function _bindStt() {
    const btn     = document.getElementById('btn-mic');
    const noteEl  = document.getElementById('inspection-note');
    const statusEl = document.getElementById('stt-status');
    if (!btn) return;

    // STT 미지원 기기에서는 버튼 숨김
    if (typeof STTManager !== 'undefined' && !STTManager.supported) {
      btn.style.display = 'none';
      return;
    }

    btn.addEventListener('click', () => {
      if (typeof STTManager === 'undefined') {
        alert('STT 모듈을 불러오지 못했습니다.');
        return;
      }
      if (STTManager.listening) {
        STTManager.stop();
        return;
      }

      _setSttStatus('🎤 듣는 중... (말하세요)', true);
      let interim = '';

      STTManager.start({
        onResult: (transcript, isFinal) => {
          if (isFinal) {
            if (noteEl) noteEl.value = (noteEl.value ? noteEl.value + ' ' : '') + transcript;
            interim = '';
            _setSttStatus('✅ 입력 완료. 관련 절차서를 검색 중...', false);
            _searchProcedureByText(noteEl?.value || transcript);
          } else {
            interim = transcript;
            if (statusEl) statusEl.textContent = `🎤 ${interim}`;
          }
        },
        onEnd: () => {
          btn.classList.remove('btn-mic--active');
          if (statusEl && statusEl.textContent.startsWith('🎤 듣는')) {
            _setSttStatus('', false);
          }
        },
        onError: (msg) => {
          btn.classList.remove('btn-mic--active');
          _setSttStatus(`⚠️ ${msg}`, false);
          setTimeout(() => _setSttStatus('', false), 3000);
        }
      });
      btn.classList.add('btn-mic--active');
    });
  }

  // STT 상태 텍스트 표시
  // @param msg     표시할 메시지 (빈 문자열이면 숨김)
  // @param loading 로딩 도트 표시 여부
  function _setSttStatus(msg, loading) {
    const el = document.getElementById('stt-status');
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.classList.remove('hidden');
    el.textContent = msg;
  }

  // STT 텍스트로 작업절차서 BM25 검색 후 UI 표시
  // @param text  검색 쿼리 (STT 결과)
  async function _searchProcedureByText(text) {
    if (typeof ProcedureManager === 'undefined' || !text) return;
    try {
      const results = await ProcedureManager.search(text, 3);
      if (results.length === 0) {
        _setSttStatus('ℹ️ 관련 절차서 없음 (절차서 관리에서 업로드하세요)', false);
        setTimeout(() => _setSttStatus('', false), 4000);
        return;
      }
      _setSttStatus('', false);
      _showProcedureMatch(results);
    } catch (e) {
      console.error('[Inspection] procedure search error:', e);
      _setSttStatus('', false);
    }
  }

  // 작업절차서 매칭 결과 UI 표시
  // @param results  [{proc, score}] 배열
  function _showProcedureMatch(results) {
    const area    = document.getElementById('proc-match-area');
    const listEl  = document.getElementById('proc-match-list');
    if (!area || !listEl) return;

    listEl.innerHTML = results.map(({ proc }) => `
      <button class="proc-match-item" data-id="${proc.id}">
        <span class="proc-match-item-title">${_esc(proc.title)}</span>
        <span class="proc-match-item-select">선택</span>
      </button>`).join('');

    area.classList.remove('hidden');

    // 절차서 선택 이벤트
    listEl.querySelectorAll('.proc-match-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id  = Number(btn.dataset.id);
        const hit = results.find(r => r.proc.id === id);
        if (hit) _selectProcedure(hit.proc);
        area.classList.add('hidden');
      });
    });
  }

  // 작업절차서 선택 처리
  // @param proc  절차서 객체 {id, title, fullText, ...}
  function _selectProcedure(proc) {
    _selectedProcedure = proc;
    const badge   = document.getElementById('selected-proc-badge');
    const titleEl = document.getElementById('selected-proc-title');
    if (titleEl) titleEl.textContent = proc.title;
    badge?.classList.remove('hidden');
  }

  // 선택된 절차서 해제
  function _clearProcedure() {
    _selectedProcedure = null;
    document.getElementById('selected-proc-badge')?.classList.add('hidden');
  }

  // HTML 이스케이프 (inspection 내부용)
  function _esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── AI 분석 실행 ───────────────────────────────────────────────────
  async function _startAnalysis() {
    isAnalyzing = true;
    _updateInspectButton();

    const note     = document.getElementById('inspection-note')?.value.trim() || '';
    const catLabel = CATEGORY_PROMPT[selectedCategory];
    const now      = new Date().toLocaleString('ko-KR');

    // 결과 섹션 초기화 및 표시
    const resultSection = document.getElementById('result-section');
    const resultBody    = document.getElementById('result-body');
    const resultTime    = document.getElementById('result-time');
    if (resultTime)   resultTime.textContent = now;
    if (resultSection) resultSection.classList.remove('hidden');
    if (resultBody) {
      resultBody.innerHTML = `
        <div class="result-loading">
          <span></span><span></span><span></span>
          <span class="result-loading-text">AI가 현장을 분석 중입니다...</span>
        </div>`;
    }

    // 화면 스크롤
    resultSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // 작업절차서 컨텍스트 (선택된 경우에만 포함)
    const procSection = _selectedProcedure
      ? `\n\n[작업절차서: ${_selectedProcedure.title}]\n${_selectedProcedure.fullText.slice(0, 2000)}\n`
      : '';

    // 절차서 준수 섹션 (절차서 선택 시 추가)
    const procOutputSection = _selectedProcedure
      ? `\n## 📝 작업절차서 준수 현황\n작업절차서의 주요 단계와 현장 상황을 비교하여 준수/미준수/확인불가 항목을 기술하세요.\n`
      : '';

    // 절차서 섹션 수 (4 or 5)
    const sectionCount = _selectedProcedure ? '5' : '4';

    // 프롬프트 구성
    const prompt = `당신은 산업안전보건 전문가입니다.
업로드된 현장 ${attachedMedia.isVideo ? '동영상(첫 프레임)' : '이미지'}를 분석하여 아래 형식으로 안전점검 보고서를 작성해주세요.

점검 분야: ${catLabel}
${note ? `현장 메모: ${note}` : ''}${procSection}
---
출력 형식(마크다운):

## 🔍 종합 위험도: [🔴 위험 / 🟡 주의 / 🟢 양호]

## ⚠️ 발견된 위험 요소
각 위험 요소를 번호와 함께 구체적으로 나열하세요.

## 🚨 즉각 조치 사항
지금 당장 취해야 할 조치를 우선순위 순으로 작성하세요.

## 📋 개선 권고사항
중장기적으로 개선해야 할 사항을 작성하세요.
${procOutputSection}---
위 ${sectionCount}개 섹션만 작성하세요. 그 외 추가 섹션(특별 권고사항, 법령 안내 등)은 작성하지 마세요.`;

    // 스트리밍 수신
    let fullText  = '';
    let started   = false;
    const settings = (typeof window.getSettings === 'function') ? window.getSettings() : {};

    tokenListener = ClaudeBridge.addListener('onToken', ({ token, done, error }) => {
      if (error) {
        if (resultBody) resultBody.innerHTML = `<div class="result-error">⚠️ 오류: ${error}</div>`;
        _finishAnalysis();
        return;
      }
      if (done || token === null) {
        if (resultBody) {
          resultBody.innerHTML = _renderResult(fullText);
        }
        _lastResultText = fullText;
        _lastLawText    = '';          // 새 점검이므로 초기화
        _saveHistory(now, fullText);
        _finishAnalysis();
        // 2단계: 법령 매칭 파이프라인 (fire-and-forget)
        _runLawRetrieval(fullText);
        return;
      }
      if (!started) {
        if (resultBody) resultBody.innerHTML = '';
        started = true;
      }
      fullText += token;
      if (resultBody) {
        resultBody.innerHTML = (typeof marked !== 'undefined')
          ? marked.parse(fullText, { breaks: true, gfm: true })
          : fullText.replace(/\n/g, '<br>');
      }
      resultSection?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });

    try {
      await ClaudeBridge.generate({
        prompt,
        history:        [],
        imageBase64:    attachedMedia.base64,
        imageMediaType: 'image/jpeg',
        maxTokens:      settings.maxTokens || 4096,
        language:       'ko',
        systemPrompt:   '당신은 대한민국 산업안전보건법 전문가이자 현장 안전관리 전문가입니다. 한국어로 답변하세요.'
      });
    } catch (err) {
      if (resultBody) resultBody.innerHTML = `<div class="result-error">⚠️ 오류: ${err.message}</div>`;
      _finishAnalysis();
    }
  }

  function _finishAnalysis() {
    if (tokenListener) { tokenListener.remove(); tokenListener = null; }
    isAnalyzing = false;
    _updateInspectButton();
    const btn = document.getElementById('btn-inspect');
    if (btn) btn.textContent = '다시 점검하기';
    // 보고서 생성 액션 바 표시
    document.getElementById('report-action-bar')?.classList.remove('hidden');
  }

  // ── 법령 매칭 파이프라인 (2단계) ─────────────────────────────────────
  async function _runLawRetrieval(analysisText) {
    // LawRetriever가 없으면 스킵
    if (typeof LawRetriever === 'undefined') return;

    const lawSection = document.getElementById('law-citation-section');
    const lawBody    = document.getElementById('law-citation-body');
    if (!lawSection || !lawBody) return;

    // 섹션 표시 + 로딩
    lawSection.classList.remove('hidden');
    lawBody.innerHTML = `
      <div class="result-loading">
        <span></span><span></span><span></span>
        <span class="result-loading-text">관련 법령을 검색 중입니다...</span>
      </div>`;
    // 스크롤: inspection-body 컨테이너 기준으로 스크롤
    setTimeout(() => lawSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);

    // 법령 데이터 로드
    const ok = await LawRetriever.load();
    if (!ok) {
      lawBody.innerHTML = '<div class="law-no-result">법령 데이터를 불러올 수 없습니다.</div>';
      return;
    }

    // BM25 검색 (법령별 유사도 1위 항목만)
    const results       = LawRetriever.searchByLaw(analysisText, { category: selectedCategory, topKEach: 1 });
    const oshaChunks    = results.osha    || [];
    const seriousChunks = results.serious || [];

    if (oshaChunks.length === 0 && seriousChunks.length === 0) {
      lawBody.innerHTML = '<div class="law-no-result">관련 법령 조항을 찾지 못했습니다.</div>';
      return;
    }

    // Claude 2차 호출용 컨텍스트 구성
    const chunkToText = (c) =>
      `[${c.law} ${c.article_no}${c.article_title ? ' (' + c.article_title + ')' : ''}]\n${c.full_text}`;

    const lawContext = [
      oshaChunks.length > 0    ? '=== 산업안전보건법 시행령 ===\n' + oshaChunks.map(chunkToText).join('\n\n')    : '',
      seriousChunks.length > 0 ? '=== 중대재해처벌법 시행령 ===\n' + seriousChunks.map(chunkToText).join('\n\n') : ''
    ].filter(Boolean).join('\n\n');

    const lawPrompt = `아래 [점검 결과]에서 식별된 위험요소와 [관련 법령 조항]을 바탕으로,
각 법령 조항이 왜 적용되는지 간결하게 해설해주세요.

[점검 결과 요약]
${analysisText.slice(0, 800)}

[관련 법령 조항]
${lawContext}

출력 형식(마크다운):
## 📌 관련 법령

각 조항에 대해 아래 형식으로 작성하세요:
### [법령명] [조번호] ([조항 제목])
- **적용 이유**: 위험요소와의 관련성 (1~2문장)
- **의무 사항**: 사업주/경영책임자가 취해야 할 구체적 조치`;

    // 로딩 → 생성 중
    lawBody.innerHTML = `
      <div class="result-loading">
        <span></span><span></span><span></span>
        <span class="result-loading-text">법령 해설을 생성 중입니다...</span>
      </div>`;

    let lawFullText = '';
    let lawStarted  = false;
    const settings  = (typeof window.getSettings === 'function') ? window.getSettings() : {};

    await new Promise((resolve) => {
      _lawListener = ClaudeBridge.addListener('onToken', ({ token, done, error }) => {
        if (error) {
          lawBody.innerHTML = `<div class="result-error">⚠️ 법령 해설 오류: ${error}</div>`;
          _lawListener?.remove(); _lawListener = null;
          resolve();
          return;
        }
        if (done || token === null) {
          _lastLawText = lawFullText;   // PDF용 저장
          lawBody.innerHTML = _renderResult(lawFullText);
          _lawListener?.remove(); _lawListener = null;
          resolve();
          return;
        }
        if (!lawStarted) {
          lawBody.innerHTML = '';
          lawStarted = true;
        }
        lawFullText += token;
        lawBody.innerHTML = _renderResult(lawFullText);
        // 스크롤: 부모 컨테이너 끝으로
        const body = document.getElementById('inspection-body');
        if (body) body.scrollTop = body.scrollHeight;
      });

      ClaudeBridge.generate({
        prompt:       lawPrompt,
        history:      [],
        imageBase64:  null,
        maxTokens:    settings.maxTokens || 2048,
        language:     'ko',
        systemPrompt: LAW_SYSTEM_PROMPT
      }).catch(err => {
        lawBody.innerHTML = `<div class="result-error">⚠️ 법령 해설 오류: ${err.message}</div>`;
        _lawListener?.remove(); _lawListener = null;
        resolve();
      });
    });
  }

  function _renderResult(text) {
    if (typeof marked !== 'undefined') {
      return marked.parse(text, { breaks: true, gfm: true });
    }
    return text.replace(/\n/g, '<br>');
  }

  // ── 마크다운 → 순수 텍스트 변환 (PDF용) ─────────────────────────────
  function _stripMd(text) {
    return (text || '')
      .replace(/[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{27BF}]/gu, '') // 이모지 제거
      .replace(/^#{1,6}\s+/gm, '')        // 제목
      .replace(/\*\*(.*?)\*\*/g, '$1')    // 볼드
      .replace(/\*(.*?)\*/g, '$1')        // 이탤릭
      .replace(/`(.*?)`/g, '$1')          // 코드
      .replace(/^[-*]\s+/gm, '• ')        // 불릿 리스트
      .replace(/\n{3,}/g, '\n\n')         // 과도한 개행
      .trim();
  }

  function _extractSections(markdown) {
    const out = { riskLevel: '', hazards: '', actions: '', recommendations: '', procedure: '' };
    const parts = (markdown || '').split(/(?=^## )/m);
    for (const part of parts) {
      const body = _stripMd(part.replace(/^## [^\n]+\n?/, '').trim());
      if (/종합.?위험도|위험도/.test(part))         out.riskLevel       = body;
      else if (/위험.?요소/.test(part))              out.hazards         = body;
      else if (/즉각.?조치|즉시/.test(part))         out.actions         = body;
      else if (/개선.?권고|권고/.test(part))         out.recommendations = body;
      else if (/절차서.?준수|준수.?현황/.test(part)) out.procedure       = body;
    }
    return out;
  }

  // ── 보고서 모달 열기 ────────────────────────────────────────────────
  function _showReport() {
    const modal = document.getElementById('report-modal');
    const body  = document.getElementById('report-modal-body');
    if (!modal || !body) return;

    body.innerHTML = _buildReportHtml();
    modal.classList.remove('hidden');
    // 모달 열릴 때 스크롤 맨 위로
    body.scrollTop = 0;
  }

  function _hideReport() {
    document.getElementById('report-modal')?.classList.add('hidden');
  }

  // ── 섹션별 마크다운 추출 (렌더링용, 원본 마크다운 보존) ──────────────
  function _extractSectionsMd(markdown) {
    const out = { riskLevel: '', hazards: '', actions: '', recommendations: '', procedure: '' };
    const parts = (markdown || '').split(/(?=^## )/m);
    for (const part of parts) {
      const body = part.replace(/^## [^\n]+\n?/, '').trim();
      if (/종합.?위험도|위험도/.test(part))         out.riskLevel       = _stripMd(body);
      else if (/위험.?요소/.test(part))              out.hazards         = body;
      else if (/즉각.?조치|즉시/.test(part))         out.actions         = body;
      else if (/개선.?권고|권고/.test(part))         out.recommendations = body;
      else if (/절차서.?준수|준수.?현황/.test(part)) out.procedure       = body;
    }
    return out;
  }

  function _getRiskClass(text) {
    if (!text) return 'normal';
    if (/위험|🔴|높음|심각|red/.test(text)) return 'danger';
    if (/주의|🟡|보통|yellow/.test(text))   return 'warning';
    return 'safe';
  }

  function _md(text) {
    if (!text) return '';
    return (typeof marked !== 'undefined')
      ? marked.parse(text, { breaks: true, gfm: true })
      : text.replace(/\n/g, '<br>');
  }

  // ── HTML 보고서 빌드 ─────────────────────────────────────────────────
  function _buildReportHtml() {
    const sections  = _extractSectionsMd(_lastResultText);
    const riskClass = _getRiskClass(sections.riskLevel);
    const catLabel  = CATEGORY_PROMPT[selectedCategory] || selectedCategory;
    const now       = new Date().toLocaleString('ko-KR');
    const lawHtml   = _md(_lastLawText);
    const imgSrc    = attachedMedia?.dataUrl || null;

    const riskLabel = {
      danger:  '🔴 위험',
      warning: '🟡 주의',
      safe:    '🟢 양호',
      normal:  '— 미확인'
    }[riskClass];

    const imgSection = imgSrc ? `
      <div class="rpt-section rpt-photo-section">
        <div class="rpt-section-title">📸 점검 사진</div>
        <img class="rpt-photo" src="${imgSrc}" alt="점검 사진">
      </div>` : '';

    const lawSection = lawHtml ? `
      <div class="rpt-section rpt-law-section">
        <div class="rpt-section-title">⚖️ 관련 법령</div>
        <div class="rpt-section-body">${lawHtml}</div>
      </div>` : '';

    const procedureSection = sections.procedure ? `
      <div class="rpt-section rpt-procedure-section">
        <div class="rpt-section-title rpt-title-procedure">📝 작업절차서 준수 현황</div>
        <div class="rpt-section-body">${_md(sections.procedure)}</div>
      </div>` : '';

    return `
<div class="rpt-document" id="rpt-document">

  <div class="rpt-header">
    <div class="rpt-header-left">
      <div class="rpt-title">안전 점검 보고서</div>
      <div class="rpt-subtitle">Safety Inspection Report</div>
    </div>
    <div class="rpt-header-right">
      <svg width="36" height="36" viewBox="0 0 44 44" fill="none">
        <circle cx="22" cy="22" r="22" fill="rgba(255,255,255,0.15)"/>
        <path d="M22 8 L34 14 V22 C34 29 28 35 22 37 C16 35 10 29 10 22 V14 Z"
              fill="none" stroke="white" stroke-width="2"/>
        <path d="M16 22 L20 26 L28 18" stroke="#4CAF50" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
  </div>

  <div class="rpt-meta">
    <div class="rpt-meta-row">
      <span class="rpt-meta-label">점검 일시</span>
      <span class="rpt-meta-value">${now}</span>
    </div>
    <div class="rpt-meta-row">
      <span class="rpt-meta-label">점검 분야</span>
      <span class="rpt-meta-value">${catLabel}</span>
    </div>
  </div>

  <div class="rpt-risk rpt-risk-${riskClass}">
    <span class="rpt-risk-label">종합 위험도</span>
    <span class="rpt-risk-value">${sections.riskLevel || riskLabel}</span>
  </div>

  ${imgSection}

  <div class="rpt-section">
    <div class="rpt-section-title rpt-title-warning">⚠️ 발견된 위험 요소</div>
    <div class="rpt-section-body">${_md(sections.hazards) || '<p>—</p>'}</div>
  </div>

  <div class="rpt-section">
    <div class="rpt-section-title rpt-title-danger">🚨 즉각 조치 사항</div>
    <div class="rpt-section-body">${_md(sections.actions) || '<p>—</p>'}</div>
  </div>

  <div class="rpt-section">
    <div class="rpt-section-title rpt-title-info">📋 개선 권고사항</div>
    <div class="rpt-section-body">${_md(sections.recommendations) || '<p>—</p>'}</div>
  </div>

  ${procedureSection}

  ${lawSection}

  <div class="rpt-footer">
    <span>Safe AI — 산업안전 AI 솔루션</span>
    <span>${now}</span>
  </div>

</div>`;
  }

  // ── PDF 내보내기 (Android: 파일 저장 / PC: 브라우저 인쇄) ──────────────
  async function _exportPdf() {
    const pdfBtn = document.getElementById('btn-report-pdf');

    if (!IS_CAPACITOR) {
      // PC: 브라우저 인쇄 → 인쇄 대화상자에서 "PDF로 저장" 선택 가능
      window.print();
      return;
    }

    // Android: 네이티브 PDF 생성 후 Downloads 폴더에 저장
    if (pdfBtn) { pdfBtn.disabled = true; pdfBtn.textContent = '저장 중...'; }

    try {
      const sections  = _extractSections(_lastResultText);
      const lawText   = _stripMd(_lastLawText);
      const catLabel  = CATEGORY_PROMPT[selectedCategory] || selectedCategory;
      const now       = new Date().toLocaleString('ko-KR');
      const imageB64  = attachedMedia?.base64 || null;

      const res = await ClaudeBridge.generatePdf({
        date:            now,
        category:        catLabel,
        riskLevel:       sections.riskLevel,
        hazards:         sections.hazards,
        actions:         sections.actions,
        recommendations: sections.recommendations,
        lawCitation:     lawText,
        imageBase64:     imageB64
      });

      if (res?.path) {
        alert('✅ PDF 저장 완료!\n다운로드 폴더에서 확인하세요.\n\n' + res.path);
      }
    } catch (err) {
      alert('❌ PDF 생성 오류: ' + (err.message || String(err)));
    } finally {
      if (pdfBtn) { pdfBtn.disabled = false; pdfBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg> PDF 저장`; }
    }
  }

  // ── 점검 이력 저장 ────────────────────────────────────────────────
  function _saveHistory(time, result) {
    try {
      const history = JSON.parse(localStorage.getItem('inspection_history') || '[]');
      const firstLine = result.split('\n').find(l => l.trim()) || '점검 결과';
      history.unshift({
        id:       Date.now(),
        time,
        category: selectedCategory,
        summary:  firstLine.replace(/[#*🔍⚠🚨📋📌]/g, '').trim().slice(0, 40),
        full:     result
      });
      // 최대 20개만 보관
      localStorage.setItem('inspection_history', JSON.stringify(history.slice(0, 20)));
    } catch (_) {}
  }

  // ── 화면 진입/이탈 ────────────────────────────────────────────────
  function enter() {
    // ── 진행 중인 스트림 전부 종료 ────────────────────────────────────
    // 1차 분석 리스너 정리
    if (tokenListener) { tokenListener.remove(); tokenListener = null; }
    // 2차 법령 리스너 정리
    if (_lawListener)  { _lawListener.remove();  _lawListener  = null; }
    // 스트리밍 중단 (PC 브라우저 fetch 포함)
    if (typeof ClaudeBridge !== 'undefined') ClaudeBridge.stopGeneration();

    // ── 이전 결과 초기화 ──────────────────────────────────────────────
    document.getElementById('result-section')?.classList.add('hidden');
    document.getElementById('law-citation-section')?.classList.add('hidden');
    document.getElementById('report-action-bar')?.classList.add('hidden');
    document.getElementById('report-modal')?.classList.add('hidden');
    _lastResultText = '';
    _lastLawText    = '';
    const noteEl = document.getElementById('inspection-note');
    if (noteEl) noteEl.value = '';

    // ── STT / 절차서 초기화 ───────────────────────────────────────────
    if (typeof STTManager !== 'undefined') STTManager.stop();
    document.getElementById('stt-status')?.classList.add('hidden');
    document.getElementById('proc-match-area')?.classList.add('hidden');
    _clearProcedure();
    const btn = document.getElementById('btn-inspect');
    if (btn) { btn.disabled = true; btn.textContent = '점검하기'; }

    // ── 첨부 미디어 초기화 ────────────────────────────────────────────
    if (attachedMedia) {
      try { CameraManager.hideAttachBar({ revokeBlob: true }); } catch (_) {}
      attachedMedia = null;
      _hidePreview();
    }
    isAnalyzing = false;
  }

  return { init, enter };
})();
