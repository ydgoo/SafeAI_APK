/**
 * api-key-ui.js — API Key 입력 화면 & 관리
 *
 * 저장 위치:
 *   Capacitor (실기기) → ClaudePlugin.saveApiKey() → EncryptedSharedPreferences
 *   PC 브라우저        → localStorage 'claude_api_key' (테스트용)
 */

const ApiKeyUI = (() => {

  // ── API Key 저장/읽기 ────────────────────────────────────────────────────

  async function hasKey() {
    // Capacitor(실기기)는 API Key가 코드에 내장되어 있으므로 항상 true
    if (IS_CAPACITOR) return true;
    // PC 브라우저만 localStorage 확인
    return !!localStorage.getItem('claude_api_key');
  }

  async function saveKey(apiKey) {
    if (IS_CAPACITOR) {
      await window.Capacitor.Plugins.ClaudePlugin.saveApiKey({ apiKey });
    } else {
      localStorage.setItem('claude_api_key', apiKey);
    }
  }

  async function deleteKey() {
    if (IS_CAPACITOR) {
      try { await window.Capacitor.Plugins.ClaudePlugin.deleteApiKey(); } catch {}
    } else {
      localStorage.removeItem('claude_api_key');
    }
  }

  function getKeyLocal() {
    if (IS_CAPACITOR) return null; // native side holds the key
    return localStorage.getItem('claude_api_key') || null;
  }

  // ── 화면 표시/숨김 ───────────────────────────────────────────────────────

  function showApiKeyScreen() {
    document.getElementById('screen-apikey').classList.remove('hidden');
    document.getElementById('screen-chat').classList.add('hidden');
    // 마스킹 값 초기화
    const input = document.getElementById('apikey-input');
    if (input) { input.value = ''; input.type = 'password'; }
    document.getElementById('apikey-error')?.classList.add('hidden');
    document.getElementById('btn-apikey-submit').disabled = true;
  }

  function showChatScreen() {
    document.getElementById('screen-apikey').classList.add('hidden');
    document.getElementById('screen-chat').classList.remove('hidden');
    updateMaskedDisplay();
  }

  // 설정 패널의 마스킹된 키 표시 갱신
  function updateMaskedDisplay() {
    const el = document.getElementById('apikey-masked');
    if (!el) return;
    const key = getKeyLocal();
    if (key && key.length > 12) {
      el.textContent = key.slice(0, 10) + '···' + key.slice(-4);
    } else if (key) {
      el.textContent = 'sk-ant-···';
    } else if (IS_CAPACITOR) {
      el.textContent = 'sk-ant-···';
    } else {
      el.textContent = '(미설정)';
    }
  }

  // ── API Key 유효성 검증 (간단한 테스트 호출) ──────────────────────────────

  async function validateKey(apiKey) {
    if (IS_CAPACITOR) {
      // 네이티브에서 저장 후 테스트 요청은 generate()가 처리함
      return true;
    }
    // PC: 직접 Anthropic API ping
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }]
        })
      });
      if (resp.status === 401) return false;
      return true; // 200 또는 기타 오류도 Key 자체는 유효한 것으로 간주
    } catch {
      // 네트워크 오류일 때도 키 형식이 맞으면 일단 허용
      return apiKey.startsWith('sk-ant-');
    }
  }

  // ── 이벤트 바인딩 ────────────────────────────────────────────────────────

  function init() {
    const input     = document.getElementById('apikey-input');
    const toggleBtn = document.getElementById('btn-toggle-apikey');
    const submitBtn = document.getElementById('btn-apikey-submit');
    const errorEl   = document.getElementById('apikey-error');

    // 입력 → 버튼 활성화
    input?.addEventListener('input', () => {
      const val = input.value.trim();
      submitBtn.disabled = val.length < 20;
      errorEl?.classList.add('hidden');
    });

    // 비밀번호 표시/숨김 토글
    toggleBtn?.addEventListener('click', () => {
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      const eyeIcon = document.getElementById('eye-icon');
      if (eyeIcon) {
        eyeIcon.innerHTML = showing
          ? // 눈 아이콘 (표시)
            '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>'
          : // 눈 감은 아이콘 (숨김)
            '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path>'
            + '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path>'
            + '<line x1="1" y1="1" x2="23" y2="23"></line>';
      }
    });

    // 시작하기 버튼
    submitBtn?.addEventListener('click', async () => {
      const apiKey = input?.value.trim();
      if (!apiKey) return;

      submitBtn.disabled = true;
      submitBtn.textContent = '확인 중…';
      errorEl?.classList.add('hidden');

      const valid = await validateKey(apiKey);
      if (!valid) {
        submitBtn.disabled = false;
        submitBtn.textContent = '시작하기';
        errorEl?.classList.remove('hidden');
        return;
      }

      await saveKey(apiKey);
      submitBtn.textContent = '시작하기';
      // app.js에서 등록한 성공 콜백 호출
      if (typeof ApiKeyUI.onSuccess === 'function') {
        ApiKeyUI.onSuccess();
      }
    });

    // 설정 패널 — API Key 변경 버튼
    document.getElementById('btn-change-apikey')?.addEventListener('click', () => {
      document.getElementById('settings-overlay').classList.add('hidden');
      showApiKeyScreen();
    });
  }

  return { init, hasKey, showApiKeyScreen, showChatScreen, updateMaskedDisplay, getKeyLocal, deleteKey };
})();
