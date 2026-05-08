/**
 * camera.js — 카메라 촬영 및 이미지/비디오 파일 처리
 *
 * 이미지: 최대 1568px 리사이즈, 5MB 이하 (Claude API 제한)
 * 비디오: blob URL 보관(재생용) + 첫 프레임 추출(Claude 분석용)
 */

const CameraManager = (() => {
  const MAX_SIZE      = 1568;          // Claude API 권장 최대 크기
  const MAX_BYTES     = 5 * 1024 * 1024; // 5MB
  const JPEG_QUALITY  = 0.85;

  // { base64, mimeType, dataUrl, blobUrl?, isVideo?, videoName? }
  let attachedMedia = null;

  // ── base64 data URL에서 순수 base64 추출 ───────────────────────────────
  function stripDataUrl(dataUrl) {
    return dataUrl.split(',')[1];
  }

  // ── 이미지 리사이즈 (File → dataUrl) ──────────────────────────────────
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > MAX_SIZE || height > MAX_SIZE) {
            if (width > height) { height = Math.round(height * MAX_SIZE / width); width = MAX_SIZE; }
            else                { width  = Math.round(width  * MAX_SIZE / height); height = MAX_SIZE; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // dataUrl 재압축 (5MB 초과 시)
  function recompressDataUrl(dataUrl, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // dataUrl → 리사이즈 → 새 dataUrl (카메라 캡처용)
  function resizeFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) { height = Math.round(height * MAX_SIZE / width); width = MAX_SIZE; }
          else                { width  = Math.round(width  * MAX_SIZE / height); height = MAX_SIZE; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // ── 비디오 첫 프레임 추출 ─────────────────────────────────────────────
  function extractVideoFrame(blobUrl, seekTime = 0.5) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.crossOrigin = 'anonymous';

      const cleanup = () => {
        video.src = '';
        video.load();
      };

      video.addEventListener('loadeddata', () => {
        // seek to seekTime (또는 0 if duration < seekTime)
        video.currentTime = Math.min(seekTime, video.duration * 0.1 || 0);
      });

      video.addEventListener('seeked', () => {
        try {
          const canvas = document.createElement('canvas');
          // 최대 640px (썸네일 + Claude 분석용)
          const MAX_FRAME = 640;
          let w = video.videoWidth  || 640;
          let h = video.videoHeight || 360;
          if (w > MAX_FRAME || h > MAX_FRAME) {
            if (w > h) { h = Math.round(h * MAX_FRAME / w); w = MAX_FRAME; }
            else       { w = Math.round(w * MAX_FRAME / h); h = MAX_FRAME; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(video, 0, 0, w, h);
          const frameDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          cleanup();
          resolve(frameDataUrl);
        } catch (err) { cleanup(); reject(err); }
      });

      video.addEventListener('error', () => { cleanup(); reject(new Error('비디오 로드 실패')); });

      // 타임아웃
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('비디오 프레임 추출 타임아웃'));
      }, 8000);

      video.addEventListener('seeked', () => clearTimeout(timer), { once: true });
      video.src = blobUrl;
      video.load();
    });
  }

  // ── 첨부 UI 업데이트 (채팅 화면용) ──────────────────────────────────
  function showAttachBar(thumbDataUrl, isVideo, name) {
    const bar   = document.getElementById('image-attach-bar');
    const thumb = document.getElementById('attach-thumb');
    const badge = document.getElementById('attach-video-badge');
    const label = document.getElementById('attach-label');
    if (!bar || !thumb) return;   // inspection 화면 등에서는 스킵
    thumb.src = thumbDataUrl;
    if (badge) badge.classList.toggle('hidden', !isVideo);
    if (label) label.textContent = isVideo ? `비디오 첨부됨 · ${name || ''}` : '이미지 첨부됨';
    bar.classList.remove('hidden');
    try { Chat?.checkSendEnabled?.(); } catch (_) {}
  }

  function hideAttachBar({ revokeBlob = false } = {}) {
    document.getElementById('image-attach-bar')?.classList.add('hidden');
    const thumb = document.getElementById('attach-thumb');
    if (thumb) thumb.src = '';
    document.getElementById('attach-video-badge')?.classList.add('hidden');
    if (revokeBlob && attachedMedia?.blobUrl) URL.revokeObjectURL(attachedMedia.blobUrl);
    attachedMedia = null;
    try { Chat?.checkSendEnabled?.(); } catch (_) {}
  }

  // ── 파일 선택 처리 (이미지 + 비디오) ────────────────────────────────
  async function handleFileSelect(file) {
    if (!file) return;

    // ── 비디오 ──────────────────────────────────────────────────────
    if (file.type.startsWith('video/')) {
      try {
        const blobUrl = URL.createObjectURL(file);
        let frameDataUrl;
        try {
          frameDataUrl = await extractVideoFrame(blobUrl);
        } catch {
          // 프레임 추출 실패 시 기본 썸네일
          frameDataUrl = _videoFallbackThumb();
        }
        attachedMedia = {
          isVideo:   true,
          blobUrl,
          base64:    stripDataUrl(frameDataUrl), // Claude용 첫 프레임
          mimeType:  file.type || 'video/mp4',
          dataUrl:   frameDataUrl,               // 첨부바 썸네일
          videoName: file.name
        };
        showAttachBar(frameDataUrl, true, file.name);
      } catch (err) {
        alert('비디오를 불러오는 데 실패했습니다.');
        console.error(err);
      }
      return;
    }

    // ── 이미지 ──────────────────────────────────────────────────────
    if (file.type.startsWith('image/')) {
      try {
        let dataUrl = await resizeImage(file);
        let quality = JPEG_QUALITY;
        while (dataUrl.length * 0.75 > MAX_BYTES && quality > 0.3) {
          quality -= 0.1;
          dataUrl = await recompressDataUrl(dataUrl, quality);
        }
        attachedMedia = {
          isVideo:  false,
          base64:   stripDataUrl(dataUrl),
          mimeType: 'image/jpeg',
          dataUrl
        };
        showAttachBar(dataUrl, false);
      } catch (err) {
        alert('이미지를 불러오는 데 실패했습니다.');
        console.error(err);
      }
    }
  }

  // 비디오 썸네일 fallback (단색 + 재생 아이콘 SVG를 canvas로)
  function _videoFallbackThumb() {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 160, 90);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.moveTo(58, 32); ctx.lineTo(58, 58); ctx.lineTo(106, 45);
    ctx.closePath(); ctx.fill();
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  // ── 카메라 (Capacitor) 또는 file input fallback ──────────────────
  // onReady(media): 카메라 완료 콜백 (inspection 등 비채팅 화면에서 사용)
  async function openCamera(onReady) {
    if (typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform()) {
      const Camera = window.Capacitor.Plugins.Camera;
      if (!Camera) { document.getElementById('file-input')?.click(); return; }
      try {
        try { await Camera.requestPermissions({ permissions: ['camera', 'photos'] }); } catch (_) {}
        const photo = await Camera.getPhoto({
          quality: 85,
          allowEditing: false,
          resultType: 'base64',
          source: 'PROMPT'
        });
        const dataUrl = `data:image/jpeg;base64,${photo.base64String}`;
        const resized = await resizeFromDataUrl(dataUrl);
        attachedMedia = { isVideo: false, dataUrl: resized, base64: stripDataUrl(resized), mimeType: 'image/jpeg' };
        if (typeof onReady === 'function') onReady(attachedMedia);
        else showAttachBar(resized, false);
      } catch (err) {
        const msg = err?.message || String(err);
        const isCancelled = /cancel|denied|dismissed/i.test(msg);
        if (!isCancelled) {
          console.warn('카메라 오류 (파일 선택으로 폴백):', msg);
          document.getElementById('file-input')?.click();
        }
      }
    } else {
      document.getElementById('file-input')?.click();
    }
  }

  // handleFileSelect: onReady 제공 시 showAttachBar 대신 콜백 호출
  const _origHandleFileSelect = handleFileSelect;
  async function handleFileSelectWithCallback(file, onReady) {
    if (!file) return;
    if (file.type.startsWith('video/')) {
      try {
        const blobUrl = URL.createObjectURL(file);
        let frameDataUrl;
        try { frameDataUrl = await extractVideoFrame(blobUrl); }
        catch { frameDataUrl = _videoFallbackThumb(); }
        attachedMedia = { isVideo: true, blobUrl, base64: stripDataUrl(frameDataUrl),
          mimeType: file.type || 'video/mp4', dataUrl: frameDataUrl, videoName: file.name };
        if (typeof onReady === 'function') onReady(attachedMedia);
        else showAttachBar(frameDataUrl, true, file.name);
      } catch (err) { alert('비디오를 불러오는 데 실패했습니다.'); }
      return;
    }
    if (file.type.startsWith('image/')) {
      try {
        let dataUrl = await resizeImage(file);
        let quality = JPEG_QUALITY;
        while (dataUrl.length * 0.75 > MAX_BYTES && quality > 0.3) {
          quality -= 0.1;
          dataUrl = await recompressDataUrl(dataUrl, quality);
        }
        attachedMedia = { isVideo: false, base64: stripDataUrl(dataUrl), mimeType: 'image/jpeg', dataUrl };
        if (typeof onReady === 'function') onReady(attachedMedia);
        else showAttachBar(dataUrl, false);
      } catch (err) { alert('이미지를 불러오는 데 실패했습니다.'); }
    }
  }

  return {
    openCamera,
    handleFileSelect: handleFileSelectWithCallback,
    hideAttachBar,
    getAttachedImage() { return attachedMedia; }
  };
})();
