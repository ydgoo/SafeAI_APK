/**
 * app.js — 앱 초기화 및 화면 네비게이션
 *
 * 화면 흐름:
 *   API Key 없음 → #screen-apikey
 *   API Key 있음 → #screen-home
 *     └─ 안전점검 버튼 → #screen-inspection
 *     └─ 산업안전보건법 버튼 → #screen-law
 */

// ── 화면 전환 유틸 ─────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}

// ── 설정 저장/읽기 ────────────────────────────────────────────────────
function getSettings() {
  try { return JSON.parse(localStorage.getItem('safety_settings') || '{}'); }
  catch { return {}; }
}
function saveSettings() {
  const s = {
    language:  document.getElementById('setting-language')?.value  || 'ko',
    maxTokens: parseInt(document.getElementById('setting-tokens')?.value || '4096')
  };
  localStorage.setItem('safety_settings', JSON.stringify(s));
}
window.getSettings = getSettings;

// ── 앱 시작 ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 모듈 초기화 (개별 오류가 전체를 막지 않도록 각각 try-catch)
  try { ApiKeyUI.init(); }       catch (e) { console.warn('ApiKeyUI init:', e); }
  try { Inspection.init(); }     catch (e) { console.warn('Inspection init:', e); }
  try { LawViewer.init(); }      catch (e) { console.warn('LawViewer init:', e); }
  try { SeriousAccident.init(); } catch (e) { console.warn('SeriousAccident init:', e); }

  // API Key 여부에 따라 시작 화면 결정
  let hasKey = false;
  try {
    hasKey = await Promise.race([
      ApiKeyUI.hasKey(),
      new Promise(resolve => setTimeout(() => resolve(false), 3000)) // 3초 타임아웃
    ]);
  } catch (e) {
    console.warn('hasKey error:', e);
    hasKey = false;
  }

  if (hasKey) {
    showScreen('screen-home');
    renderRecentHistory();
  } else {
    showScreen('screen-apikey');
  }

  // API Key 입력 완료 콜백 등록
  ApiKeyUI.onSuccess = () => {
    showScreen('screen-home');
    renderRecentHistory();
  };

  bindNavEvents();
  bindSettingsEvents();
  bindImageViewerEvents();
});

// ── 네비게이션 이벤트 ─────────────────────────────────────────────────
function bindNavEvents() {

  // 홈 → 안전점검
  document.getElementById('menu-inspection')?.addEventListener('click', () => {
    try { Inspection.enter(); } catch (_) {}
    showScreen('screen-inspection');
  });

  // 홈 → 산업안전보건법
  document.getElementById('menu-law')?.addEventListener('click', () => {
    LawViewer.enter();
    showScreen('screen-law');
  });

  // 홈 → 중대재해처벌법
  document.getElementById('menu-serious-accident')?.addEventListener('click', () => {
    SeriousAccident.enter();
    showScreen('screen-serious-accident');
  });

  // 뒤로 버튼들
  document.getElementById('btn-back-inspection')?.addEventListener('click', () => {
    showScreen('screen-home');
    renderRecentHistory();
  });
  document.getElementById('btn-back-law')?.addEventListener('click', () => {
    showScreen('screen-home');
  });
  document.getElementById('btn-back-serious-accident')?.addEventListener('click', () => {
    showScreen('screen-home');
  });

  // 홈 설정 버튼
  document.getElementById('btn-home-settings')?.addEventListener('click', () => {
    loadSettingsPanel();
    ApiKeyUI.updateMaskedDisplay();
    document.getElementById('settings-overlay')?.classList.remove('hidden');
  });
}

// ── 최근 점검 이력 렌더링 ────────────────────────────────────────────
function renderRecentHistory() {
  const list = document.getElementById('recent-list');
  if (!list) return;
  try {
    const history = JSON.parse(localStorage.getItem('inspection_history') || '[]');
    if (history.length === 0) {
      list.innerHTML = '<p class="recent-empty">아직 점검 이력이 없습니다.</p>';
      return;
    }
    list.innerHTML = history.slice(0, 5).map(item => `
      <div class="recent-item" data-id="${item.id}">
        <div class="recent-item-icon">${_categoryIcon(item.category)}</div>
        <div class="recent-item-body">
          <div class="recent-item-summary">${_escHtml(item.summary || '점검 결과')}</div>
          <div class="recent-item-time">${item.time}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.4">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>`).join('');

    // 이력 클릭 → 결과 보기 (간단 모달)
    list.querySelectorAll('.recent-item').forEach(el => {
      el.addEventListener('click', () => {
        const id   = parseInt(el.dataset.id);
        const item = history.find(h => h.id === id);
        if (item) _showHistoryDetail(item);
      });
    });
  } catch (_) {}
}

function _categoryIcon(cat) {
  const icons = {
    general: '🏭', construction: '🏗️', manufacturing: '⚙️',
    chemical: '⚗️', electric: '⚡', fall: '🪜'
  };
  return icons[cat] || '🔍';
}

function _escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _showHistoryDetail(item) {
  // 점검 결과를 inspection 화면에 다시 표시
  const resultSection = document.getElementById('result-section');
  const resultBody    = document.getElementById('result-body');
  const resultTime    = document.getElementById('result-time');

  Inspection.enter();
  showScreen('screen-inspection');

  if (resultTime)    resultTime.textContent = item.time;
  if (resultSection) resultSection.classList.remove('hidden');
  if (resultBody) {
    resultBody.innerHTML = (typeof marked !== 'undefined')
      ? marked.parse(item.full || '', { breaks: true, gfm: true })
      : (item.full || '').replace(/\n/g,'<br>');
  }
  setTimeout(() => resultSection?.scrollIntoView({ behavior: 'smooth' }), 100);
}

// ── 설정 패널 ────────────────────────────────────────────────────────
function bindSettingsEvents() {
  const overlay = document.getElementById('settings-overlay');

  document.getElementById('btn-close-settings')?.addEventListener('click', () => {
    overlay?.classList.add('hidden');
  });
  overlay?.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });

  document.getElementById('setting-tokens')?.addEventListener('input', e => {
    document.getElementById('label-tokens').textContent = e.target.value;
    saveSettings();
  });
  document.getElementById('setting-language')?.addEventListener('change', saveSettings);

  document.getElementById('btn-change-apikey')?.addEventListener('click', () => {
    overlay?.classList.add('hidden');
    ApiKeyUI.showApiKeyScreen();
  });
}

function loadSettingsPanel() {
  const s = getSettings();
  const langEl   = document.getElementById('setting-language');
  const tokensEl = document.getElementById('setting-tokens');
  if (langEl)   langEl.value = s.language || 'ko';
  if (tokensEl) {
    tokensEl.value = s.maxTokens || 4096;
    document.getElementById('label-tokens').textContent = tokensEl.value;
  }
}

// ── 이미지 뷰어 ──────────────────────────────────────────────────────
function bindImageViewerEvents() {
  document.getElementById('btn-close-viewer')?.addEventListener('click', () => {
    document.getElementById('img-viewer')?.classList.add('hidden');
    document.getElementById('viewer-img').src = '';
  });
  document.getElementById('img-viewer')?.addEventListener('click', e => {
    if (e.target === document.getElementById('img-viewer')) {
      document.getElementById('img-viewer')?.classList.add('hidden');
    }
  });
}
