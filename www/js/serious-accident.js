/**
 * serious-accident.js — 중대재해처벌법 화면 로직
 * - 법령 전문 탭: law-chunks.json 에서 중대재해처벌법 시행령 조항을 카드로 표시
 * - AI 질의 탭: Claude가 중대재해처벌법 질문에 답변
 */

const SeriousAccident = (() => {

  const SA_SYSTEM_PROMPT = `당신은 대한민국 중대재해처벌등에관한법률(중대재해처벌법) 전문 해설가입니다.
중대재해처벌등에관한법률(법률 제17907호, 시행 2022.1.27.), 동법 시행령·시행규칙에 근거하여 정확하게 답변하세요.

주요 해설 영역:
- 중대산업재해(사망·부상·질병)와 중대시민재해의 정의 및 요건
- 경영책임자등의 안전·보건 확보 의무(제4조, 제5조)
- 안전보건관리체계 구축·이행 의무 9가지 항목
- 도급·용역·위탁 관계에서의 원수급인 의무(제5조)
- 형사처벌 기준: 경영책임자(1년↑ 징역 또는 10억↓ 벌금), 법인(50억↓ 벌금)
- 징벌적 손해배상(제15조): 손해의 5배 이하
- 중대시민재해 적용 대상(공중이용시설·공중교통수단 등)
- 소규모 사업장 적용 유예 및 단계적 시행

답변 원칙:
- 관련 조항 번호(조·항·호)를 반드시 인용하세요.
- 실무 적용 가능한 체크리스트·예시를 포함하세요.
- 불확실한 내용은 "법령 원문 또는 고용노동부 지침을 확인하세요"라고 안내하세요.
- 한국어로 답변하세요.`;

  // 조항 데이터 캐시
  let _articles    = null;
  let _filtered    = null;
  let _searchTimer = null;

  let isGenerating  = false;
  let tokenListener = null;
  let saHistory     = [];

  // ── 초기화 ──────────────────────────────────────────────────────────
  function init() {
    _bindTabs();
    _bindSaInput();
  }

  // ── 탭 전환 ─────────────────────────────────────────────────────────
  function _bindTabs() {
    document.querySelectorAll('.sa-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sa-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const target = tab.dataset.tab;
        document.getElementById('sa-tab-viewer')?.classList.toggle('hidden', target !== 'viewer');
        document.getElementById('sa-tab-search')?.classList.toggle('hidden', target !== 'search');
      });
    });
  }

  // ── 법령 JSON 로드 ───────────────────────────────────────────────────
  async function _loadArticles() {
    if (_articles !== null) return _articles;
    try {
      const resp = await fetch('data/law-chunks.json');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const json = await resp.json();
      const all  = json.chunks || (Array.isArray(json) ? json : []);
      // 중대재해처벌법 시행령만 필터
      _articles = all.filter(c => c.law && c.law.includes('중대재해처벌법'));
      return _articles;
    } catch (e) {
      console.warn('law-chunks.json 로드 실패:', e);
      _articles = [];
      return _articles;
    }
  }

  // ── 조항 카드 렌더링 ─────────────────────────────────────────────────
  function _renderArticles(list) {
    const container = document.getElementById('sa-article-list');
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = '<div class="law-article-empty">검색 결과가 없습니다.</div>';
      return;
    }

    container.innerHTML = list.map(c => `
      <div class="law-article-card">
        <div class="law-article-header">
          <span class="law-article-no">${_esc(c.article_no || '')}</span>
          ${c.article_title ? `<span class="law-article-title">${_esc(c.article_title)}</span>` : ''}
        </div>
        <div class="law-article-body">${_esc(c.full_text || '').replace(/\n/g, '<br>')}</div>
      </div>
    `).join('');
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // ── 검색 ─────────────────────────────────────────────────────────────
  function _bindSearch() {
    const input = document.getElementById('sa-article-search');
    if (!input) return;
    input.replaceWith(input.cloneNode(true));
    const fresh = document.getElementById('sa-article-search');
    if (!fresh) return;
    fresh.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => _doSearch(fresh.value), 200);
    });
  }

  function _doSearch(query) {
    if (!_articles) return;
    const q = query.trim().toLowerCase();
    _filtered = !q ? _articles : _articles.filter(c =>
      (c.article_no    || '').toLowerCase().includes(q) ||
      (c.article_title || '').toLowerCase().includes(q) ||
      (c.full_text     || '').toLowerCase().includes(q)
    );
    _renderArticles(_filtered);
  }

  // ── AI 질의 입력 바인딩 ──────────────────────────────────────────────
  function _bindSaInput() {
    const input   = document.getElementById('sa-input');
    const sendBtn = document.getElementById('sa-send');

    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      if (sendBtn) sendBtn.disabled = !input.value.trim() || isGenerating;
    });

    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn?.disabled) _sendQuery();
      }
    });

    sendBtn?.addEventListener('click', () => {
      if (!sendBtn.disabled) _sendQuery();
    });
  }

  // ── AI 질의 전송 ─────────────────────────────────────────────────────
  async function _sendQuery() {
    const input = document.getElementById('sa-input');
    const text  = input?.value.trim();
    if (!text || isGenerating) return;

    input.value = '';
    input.style.height = 'auto';
    document.getElementById('sa-send').disabled = true;

    const chat = document.getElementById('sa-chat');

    chat?.appendChild(_createUserBubble(text));
    _scrollChat();

    const { row, bubble } = _createAiBubble();
    chat?.appendChild(row);
    _scrollChat();

    saHistory.push({ role: 'user', content: text });
    isGenerating = true;

    let fullText  = '';
    let started   = false;
    const settings = (typeof window.getSettings === 'function') ? window.getSettings() : {};

    tokenListener = ClaudeBridge.addListener('onToken', ({ token, done, error }) => {
      if (error) {
        bubble.className = 'bubble ai error';
        bubble.textContent = '⚠️ 오류: ' + error;
        _finishQuery();
        return;
      }
      if (done || token === null) {
        bubble.classList.remove('cursor-blink');
        bubble.innerHTML = _renderMd(fullText);
        saHistory.push({ role: 'assistant', content: fullText });
        if (saHistory.length > 20) saHistory = saHistory.slice(-20);
        _finishQuery();
        _scrollChat();
        return;
      }
      if (!started) {
        bubble.className = 'bubble ai cursor-blink';
        bubble.innerHTML = '';
        started = true;
      }
      fullText += token;
      bubble.innerHTML = _renderMd(fullText);
      _scrollChat();
    });

    try {
      await ClaudeBridge.generate({
        prompt:       text,
        history:      saHistory.slice(0, -1),
        imageBase64:  null,
        maxTokens:    settings.maxTokens || 4096,
        language:     'ko',
        systemPrompt: SA_SYSTEM_PROMPT
      });
    } catch (err) {
      bubble.className = 'bubble ai error';
      bubble.textContent = '⚠️ 오류: ' + err.message;
      _finishQuery();
    }
  }

  function _finishQuery() {
    if (tokenListener) { tokenListener.remove(); tokenListener = null; }
    isGenerating = false;
    const sendBtn = document.getElementById('sa-send');
    const input   = document.getElementById('sa-input');
    if (sendBtn) sendBtn.disabled = !input?.value.trim();
  }

  // ── DOM 헬퍼 ─────────────────────────────────────────────────────────
  function _createUserBubble(text) {
    const row = document.createElement('div');
    row.className = 'msg-row user';
    const content = document.createElement('div');
    content.className = 'msg-content';
    const bubble = document.createElement('div');
    bubble.className = 'bubble user';
    bubble.textContent = text;
    content.appendChild(bubble);
    row.appendChild(content);
    return row;
  }

  function _createAiBubble() {
    const row = document.createElement('div');
    row.className = 'msg-row ai';
    const avatar = document.createElement('div');
    avatar.className = 'ai-avatar safety-avatar';
    avatar.textContent = 'AI';
    const content = document.createElement('div');
    content.className = 'msg-content';
    const bubble = document.createElement('div');
    bubble.className = 'bubble ai typing-dots';
    bubble.innerHTML = '<span></span><span></span><span></span>';
    content.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(content);
    return { row, bubble };
  }

  function _renderMd(text) {
    return (typeof marked !== 'undefined')
      ? marked.parse(text, { breaks: true, gfm: true })
      : text.replace(/\n/g, '<br>');
  }

  function _scrollChat() {
    const chat = document.getElementById('sa-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  // ── 화면 진입 ──────────────────────────────────────────────────────
  function enter() {
    // 항상 첫 번째 탭(법령 전문)으로 초기화
    document.querySelectorAll('#screen-serious-accident .sa-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('#screen-serious-accident .sa-tab[data-tab="viewer"]')?.classList.add('active');
    document.getElementById('sa-tab-viewer')?.classList.remove('hidden');
    document.getElementById('sa-tab-search')?.classList.add('hidden');

    // 조항 데이터 로드 & 표시
    const list = document.getElementById('sa-article-list');
    if (list) {
      list.innerHTML = '<div class="law-article-loading">법령 데이터를 불러오는 중...</div>';
    }
    _loadArticles().then(articles => {
      _filtered = articles;
      _renderArticles(articles);
      _bindSearch();
    });
  }

  return { init, enter };
})();
