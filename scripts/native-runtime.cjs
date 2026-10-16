const fs = require('node:fs');

// Use the reviewed public production configuration, including TURN, in both clients.
module.exports = function nativeRuntime() {
  const file = process.env.KVA_NATIVE_RUNTIME_CONFIG;
  if (!file) throw Error('Set KVA_NATIVE_RUNTIME_CONFIG to the public production runtime JSON before building installers');
  const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const iceServers = config.iceServers;
  if (!Array.isArray(iceServers) || !iceServers.some(server =>
    [server.urls].flat().some(url => typeof url === 'string' && /^turns?:/.test(url)) && server.username && server.credential
  )) throw Error('Production TURN configuration is required for native calls');
  return 'window.__TESCORD_RUNTIME_CONFIG__ = ' + JSON.stringify({
    apiBaseUrl: 'https://kvachat.ru', wsBaseUrl: 'wss://kvachat.ru',
    sfuUrl: 'wss://kvachat.ru/livekit', iceServers
  }) + ';\n';
};
