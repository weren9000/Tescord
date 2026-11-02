(() => {
  const native = window.KvaNative;
  if (!native) throw new Error('Android bridge unavailable');
  window.kvaDesktop = Object.freeze({
    version: 'android-__KVA_VERSION__',
    readSession: () => native.readSession(),
    writeSession: value => native.writeSession(value),
    readSecretVault: userId => native.readSecretVault(userId) ?? null,
    writeSecretVault: (userId, value) => native.writeSecretVault(userId, value),
    beginSecretDownload: (name, size) => new Promise(resolve => {
      let id;
      const selected = event => { if (!event.detail || event.detail === id) { window.removeEventListener('kva-secret-save', selected); resolve(event.detail || null); } };
      window.addEventListener('kva-secret-save', selected);
      id = native.beginSecretDownload(name, size);
      if (!id) { window.removeEventListener('kva-secret-save', selected); resolve(null); }
    }),
    writeSecretDownload: async (id, index, data) => {
      let text = '';
      for (let i = 0; i < data.length; i += 8192) text += String.fromCharCode(...data.subarray(i, i + 8192));
      return native.writeSecretDownload(id, index, btoa(text));
    },
    endSecretDownload: async (id, commit) => native.endSecretDownload(id, commit),
    // Native background service owns notifications, avoiding duplicate web notifications.
    notify: async () => false,
    clearNotifications: target => { if (target) native.clear(target); },
    onNotificationOpen: callback => {
      const handler = event => {native.pendingTarget(); callback(event.detail);};
      window.addEventListener('kva-open', handler);
      const target = native.pendingTarget();
      if (target) setTimeout(() => callback(target), 1000);
      return () => window.removeEventListener('kva-open', handler);
    }
  });
  window.kvaAndroid = {
    pendingCall: () => native.pendingCall(),
    directAudio: active => native.directAudio?.(active),
    audioRoutes: () => JSON.parse(native.audioRoutes?.() || '[]'),
    selectAudioRoute: id => native.selectAudioRoute?.(id) || false
  };
  const tracks = new Set();
  const syncMedia = () => native.media([...tracks].some(track => track.kind === 'audio'), [...tracks].some(track => track.kind === 'video'));
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    const stream = await getUserMedia(constraints);
    for (const track of stream.getTracks()) {
      tracks.add(track);
      const stop = track.stop.bind(track);
      const remove = () => { tracks.delete(track); syncMedia(); };
      track.stop = () => { stop(); remove(); };
      track.addEventListener('ended', remove, {once: true});
    }
    syncMedia(); return stream;
  };
  let active = false;
  navigator.mediaDevices.getDisplayMedia = async () => {
    if (active) throw new DOMException('Screen capture already active', 'InvalidStateError');
    active = true;
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      let stream, finished = false, busy = false;
      // Permission dialogs can stay open; only time out after Android confirms capture.
      let startupTimer;
      const started = () => { startupTimer = setTimeout(() => error({detail: 'Не удалось получить изображение экрана'}), 20000); };
      const stop = () => {
        if (finished) return; finished = true; active = false;
        clearTimeout(startupTimer);
        window.removeEventListener('kva-screen-started', started);
        window.removeEventListener('kva-screen-frame', frame);
        window.removeEventListener('kva-screen-error', error);
        window.removeEventListener('kva-screen-ended', ended);
        native.stopScreen();
        if (stream) for (const track of stream.getTracks()) {track.stop(); track.dispatchEvent(new Event('ended'));}
      };
      const error = event => { stop(); reject(new DOMException(event.detail || 'Capture cancelled', 'NotAllowedError')); };
      const ended = () => { if (!stream) reject(new DOMException('Capture ended', 'AbortError')); stop(); };
      const frame = event => {
        if (busy || finished) return; busy = true;
        const img = new Image();
        img.onload = () => {
          busy = false; if (finished) return;
          canvas.width = img.width; canvas.height = img.height; context.drawImage(img, 0, 0);
          if (!stream) {
            clearTimeout(startupTimer);
            stream = canvas.captureStream(8);
            const track = stream.getVideoTracks()[0];
            const originalStop = track.stop.bind(track);
            track.stop = () => { originalStop(); stop(); };
            resolve(stream);
          }
        };
        img.onerror = () => { busy = false; };
        img.src = 'data:image/jpeg;base64,' + event.detail;
      };
      window.addEventListener('kva-screen-frame', frame);
      window.addEventListener('kva-screen-started', started);
      window.addEventListener('kva-screen-error', error);
      window.addEventListener('kva-screen-ended', ended);
      native.startScreen();
    });
  };
})();
