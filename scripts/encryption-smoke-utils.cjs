// Real media, isolated local API/DB only. Never point these fixtures at production.
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('../frontend/node_modules/@playwright/test');
const root = path.resolve(__dirname, '..');
const apiBase = process.env.KVA_ENCRYPTION_API || 'http://127.0.0.1:8027';
const uiBase = process.env.KVA_ENCRYPTION_UI || 'http://127.0.0.1:4200';
for (const base of [apiBase, uiBase]) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Encryption smoke tests require loopback services');
}
const fixturePath = process.env.KVA_ENCRYPTION_FIXTURE || path.join(root, '.local/secret-e2e.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
if (!fixture.database?.startsWith('test_secret_e2e_') || fixture.users.some(u => !u.email.endsWith('@secret-e2e.test'))) throw Error('Disposable encryption fixture required');
const output = path.join(root, '.local/encryption-checks');fs.mkdirSync(output, {recursive: true});
async function api(path, token, body, method = 'POST') {
  const r = await fetch(apiBase + '/api' + path, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  if (!r.ok) throw Error('Local test API: ' + path + ' ' + r.status);
  return r.status === 204 ? null : r.json();
}
const login = index => api('/auth/login', null, {email: fixture.users[index].email, password: 'local-test-only-password'});
async function instrument(context) {
  await context.addInitScript(() => {
    window.testCallReady = false;
    const Socket = WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args);
        if (String(args[0]).includes('/calls/ws')) this.addEventListener('message', event => {
          try {if (JSON.parse(event.data).type === 'ready') window.testCallReady = true;} catch {}
        });
      }
    };
    window.testPeers = [];
    const Native = RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {constructor(...args) {super(...args);window.testPeers.push(this);}};
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints.audio) return gum(constraints);
      const ctx = new AudioContext();await ctx.resume();
      const source = ctx.createOscillator(), dest = ctx.createMediaStreamDestination();
      source.frequency.value = 440;source.connect(dest);source.start();
      return dest.stream;
    };
    navigator.mediaDevices.getDisplayMedia = () => gum({video: true, audio: false});
    window.testPcm = async () => {
      const track = window.testPeers.filter(pc => pc.connectionState === 'connected').flatMap(pc => pc.getReceivers()).find(r => r.track.kind === 'audio' && r.track.readyState === 'live')?.track;
      if (!track) return 0;
      if (!window.testMeter || window.testMeter.track !== track) {
        const ctx = new AudioContext();await ctx.resume();
        const source = ctx.createMediaStreamSource(new MediaStream([track])), analyser = ctx.createAnalyser();analyser.fftSize = 2048;source.connect(analyser);
        window.testMeter = {ctx, source, analyser, track};
      }
      const data = new Float32Array(2048);window.testMeter.analyser.getFloatTimeDomainData(data);
      return Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
    };
  });
}
async function verify(pages) {
  for (const page of pages) await expect(page.locator('app-call-encryption [data-phase="verify"]')).toBeVisible({timeout: 15000});
  for (const page of pages) await expect(page.getByRole('button', {name: 'Код совпадает у всех', exact: true})).toBeVisible();
  await expect.poll(async () => new Set(await Promise.all(pages.map(p => p.locator('app-call-encryption code').innerText()))).size, {timeout: 15000}).toBe(1);
  for (const page of pages) await page.getByRole('button', {name: 'Код совпадает у всех', exact: true}).click();
  for (const page of pages) await expect(page.locator('app-call-encryption [data-phase="secure"]')).toBeVisible({timeout: 20000});
  for (const page of pages) await expect.poll(() => page.evaluate(() => window.testPcm()), {timeout: 15000}).toBeGreaterThan(.01);
}
module.exports = {root, apiBase, uiBase, fixture, output, api, login, instrument, verify};
