// Public endpoints only. Authorized media grants supply temporary TURN credentials.
module.exports = function nativeRuntime() {
  return 'window.__TESCORD_RUNTIME_CONFIG__ = ' + JSON.stringify({
    apiBaseUrl: 'https://kvachat.ru', wsBaseUrl: 'wss://kvachat.ru',
    sfuUrl: 'wss://kvachat.ru/livekit'
  }) + ';\n';
};
