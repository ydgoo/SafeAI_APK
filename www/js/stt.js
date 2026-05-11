// File    : stt.js
// Desc    : Web Speech API wrapper for Korean STT input
// Date    : 2025-05-11
// Author  : SafeAI

const STTManager = (() => {
  'use strict';

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const _supported = !!SpeechRecognition;
  let _recognition = null;
  let _listening    = false;

  // Error code → user-friendly Korean message
  function _errMsg(code) {
    const map = {
      'not-allowed':   '마이크 권한을 허용해주세요.',
      'no-speech':     '음성을 감지하지 못했습니다. 다시 시도하세요.',
      'audio-capture': '마이크를 찾을 수 없습니다.',
      'network':       '네트워크 오류가 발생했습니다.',
      'aborted':       '음성 인식이 중단되었습니다.',
    };
    return map[code] || `음성 인식 오류 (${code})`;
  }

  // Start STT recognition
  // @param onResult(transcript, isFinal) - called for each interim/final result
  // @param onEnd()                        - called when recognition session ends
  // @param onError(msg)                   - called on error
  function start({ onResult, onEnd, onError } = {}) {
    if (!_supported) {
      onError?.('이 기기는 음성 인식을 지원하지 않습니다.');
      return;
    }
    if (_listening) stop();

    _recognition = new SpeechRecognition();
    _recognition.lang            = 'ko-KR';
    _recognition.interimResults  = true;
    _recognition.continuous      = false;
    _recognition.maxAlternatives = 1;

    _recognition.onresult = (e) => {
      const result = e.results[e.results.length - 1];
      onResult?.(result[0].transcript, result.isFinal);
    };

    _recognition.onend = () => {
      _listening = false;
      onEnd?.();
    };

    _recognition.onerror = (e) => {
      _listening = false;
      onError?.(_errMsg(e.error));
    };

    _recognition.start();
    _listening = true;
  }

  // Stop ongoing recognition session
  function stop() {
    if (_recognition) {
      try { _recognition.stop(); } catch (_) {}
      _recognition = null;
    }
    _listening = false;
  }

  return {
    start,
    stop,
    get supported() { return _supported; },
    get listening()  { return _listening;  }
  };
})();
