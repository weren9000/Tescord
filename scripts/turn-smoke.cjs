const { chromium } = require('../desktop/node_modules/playwright');

(async () => {
  // Feed an authorized media grant as JSON on stdin; never put credentials in argv or logs.
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const grant = JSON.parse(input);
  const iceServers = grant.ice_servers;
  if (!Array.isArray(iceServers) || !iceServers.length) throw Error('A media grant with temporary ICE servers is required on stdin');
  const browser = await chromium.launch({
    executablePath: process.env.KVA_CHROME || undefined,
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.goto('https://kvachat.ru/login');
    const result = await page.evaluate(async (iceServers) => {
      const config = { iceServers, iceTransportPolicy: 'relay' };
      const a = new RTCPeerConnection(config), b = new RTCPeerConnection(config);
      const pendingA = [], pendingB = [];
      a.onicecandidate = e => { if(e.candidate) b.remoteDescription ? b.addIceCandidate(e.candidate) : pendingB.push(e.candidate); };
      b.onicecandidate = e => { if(e.candidate) a.remoteDescription ? a.addIceCandidate(e.candidate) : pendingA.push(e.candidate); };
      try {
        const channel = a.createDataChannel('relay-check');
        const received = new Promise(resolve => { b.ondatachannel = e => { e.channel.onmessage = event => resolve(event.data); }; });
        await a.setLocalDescription(await a.createOffer());
        await b.setRemoteDescription(a.localDescription);
        for(const candidate of pendingB) await b.addIceCandidate(candidate);
        await b.setLocalDescription(await b.createAnswer());
        await a.setRemoteDescription(b.localDescription);
        for(const candidate of pendingA) await a.addIceCandidate(candidate);
        await Promise.race([
          new Promise(resolve => { if(channel.readyState === 'open') resolve(); else channel.onopen = resolve; }),
          new Promise((_,reject) => setTimeout(() => reject(Error('TURN connection timeout')),25000))
        ]);
        channel.send('kva-relay-check');
        const message = await Promise.race([received, new Promise((_,reject) => setTimeout(() => reject(Error('TURN data timeout')),5000))]);
        const stats = await a.getStats();
        const pair = [...stats.values()].find(s => s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated);
        return { message, local: stats.get(pair?.localCandidateId)?.candidateType, remote: stats.get(pair?.remoteCandidateId)?.candidateType };
      } finally { a.close(); b.close(); }
    }, iceServers);
    if(result.message !== 'kva-relay-check' || result.local !== 'relay' || result.remote !== 'relay') throw Error('Relay verification failed');
    console.log('PASS: production TURN, relay-to-relay connection and data transfer');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
