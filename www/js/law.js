/**
 * law.js — 산업안전보건법 화면 로직
 * - 법령 전문 탭: law-chunks.json 에서 산업안전보건법 시행령 조항을 카드로 표시
 * - AI 질의 탭: Claude가 법령 질문에 답변
 */

const LawViewer = (() => {

  const LAW_SYSTEM_PROMPT = `당신은 대한민국 산업안전보건법 전문 해설가입니다.
산업안전보건법(법률 제18426호)과 관련 시행령·시행규칙에 근거하여 정확하게 답변하세요.
- 관련 법조문(조항 번호)을 반드시 인용하세요.
- 실무적으로 적용 가능한 구체적인 내용을 포함하세요.
- 불확실한 내용은 "법령 원문을 확인하세요"라고 안내하세요.
- 한국어로 답변하세요.`;

  // 조항 데이터 (최초 1회 로드 후 캐시)
  let _articles     = null;
  let _filtered     = null;
  let _searchTimer  = null;

  let isGenerating  = false;
  let tokenListener = null;
  let lawHistory    = [];

  // ── 초기화 ──────────────────────────────────────────────────────────
  function init() {
    _bindTabs();
    _bindLawInput();
  }

  // ── 탭 전환 ─────────────────────────────────────────────────────────
  function _bindTabs() {
    document.querySelectorAll('.law-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.law-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const target = tab.dataset.tab;
        document.getElementById('law-tab-viewer')?.classList.toggle('hidden', target !== 'viewer');
        document.getElementById('law-tab-search')?.classList.toggle('hidden', target !== 'search');
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
      // 산업안전보건법 시행령만 필터
      _articles = all.filter(c => c.law && c.law.includes('산업안전보건법'));
      return _articles;
    } catch (e) {
      console.warn('law-chunks.json 로드 실패:', e);
      _articles = [];
      return _articles;
    }
  }

  // ── 조항 카드 렌더링 ─────────────────────────────────────────────────
  function _renderArticles(list) {
    const container = document.getElementById('law-article-list');
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
    const input = document.getElementById('law-article-search');
    if (!input) return;
    // 이벤트 중복 방지
    input.replaceWith(input.cloneNode(true));
    const fresh = document.getElementById('law-article-search');
    if (!fresh) return;
    fresh.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => _doSearch(fresh.value), 200);
    });
  }

  function _doSearch(query) {
    if (!_articles) return;
    const q = query.trim().toLowerCase();
    if (!q) {
      _filtered = _articles;
    } else {
      _filtered = _articles.filter(c =>
        (c.article_no    || '').toLowerCase().includes(q) ||
        (c.article_title || '').toLowerCase().includes(q) ||
        (c.full_text     || '').toLowerCase().includes(q)
      );
    }
    _renderArticles(_filtered);
  }

  // ── AI 질의 입력 ─────────────────────────────────────────────────────
  function _bindLawInput() {
    const input   = document.getElementById('law-input');
    const sendBtn = document.getElementById('law-send');

    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      if (sendBtn) sendBtn.disabled = !input.value.trim() || isGenerating;
    });

    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn?.disabled) _sendLawQuery();
      }
    });

    sendBtn?.addEventListener('click', () => {
      if (!sendBtn.disabled) _sendLawQuery();
    });
  }

  // ── AI 질의 전송 ─────────────────────────────────────────────────────
  async function _sendLawQuery() {
    const input = document.getElementById('law-input');
    const text  = input?.value.trim();
    if (!text || isGenerating) return;

    input.value = '';
    input.style.height = 'auto';
    document.getElementById('law-send').disabled = true;

    const chat = document.getElementById('law-chat');

    chat?.appendChild(_createUserBubble(text));
    _scrollChat();

    const { row, bubble } = _createAiBubble();
    chat?.appendChild(row);
    _scrollChat();

    lawHistory.push({ role: 'user', content: text });
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
        lawHistory.push({ role: 'assistant', content: fullText });
        if (lawHistory.length > 20) lawHistory = lawHistory.slice(-20);
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
        prompt:      text,
        history:     lawHistory.slice(0, -1),
        imageBase64: null,
        maxTokens:   settings.maxTokens || 4096,
        language:    'ko',
        systemPrompt: LAW_SYSTEM_PROMPT
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
    const sendBtn = document.getElementById('law-send');
    const input   = document.getElementById('law-input');
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
    const chat = document.getElementById('law-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  // ── 화면 진입 ──────────────────────────────────────────────────────
  function enter() {
    // 항상 첫 번째 탭(법령 전문)으로 초기화
    document.querySelectorAll('#screen-law .law-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('#screen-law .law-tab[data-tab="viewer"]')?.classList.add('active');
    document.getElementById('law-tab-viewer')?.classList.remove('hidden');
    document.getElementById('law-tab-search')?.classList.add('hidden');

    // 조항 데이터 로드 & 표시
    const list = document.getElementById('law-article-list');
    if (list) {
      list.innerHTML = '<div class="law-article-loading">법령 데이터를 불러오는 중...</div>';
    }
    _loadArticles().then(articles => {
      _filtered = articles;
      _renderArticles(articles);
      _bindSearch();  // 검색 이벤트 바인딩 (화면 진입마다 갱신)
    });
  }

  return { init, enter };
})();
