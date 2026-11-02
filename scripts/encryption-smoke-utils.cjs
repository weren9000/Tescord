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
  for (const page of pages) {
    await expect(page.locator('app-call-encryption code')).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Код совпадает у всех', exact: true})).toHaveCount(0);
  }
  for (const page of pages) await expect(page.locator('app-call-encryption [data-phase="secure"]')).toBeVisible({timeout: 20000});
  for (const page of pages) await expect.poll(() => page.evaluate(() => window.testPcm()), {timeout: 15000}).toBeGreaterThan(.01);
}
async function checkCallLayout(page, name) {
  const original = await page.evaluate(() => ({style: document.documentElement.getAttribute('style'), scheme: document.documentElement.dataset.uiScheme}));
  const viewport = page.viewportSize();
  for (const scheme of ['dark', 'light']) {
    if (scheme === 'light') await page.evaluate(() => {
      const element = document.documentElement;
      element.dataset.uiScheme = 'light';element.style.colorScheme = 'light';
      const palette = {canvas:'#f5f6fa',surface:'#ffffff',raised:'#f1f2f7',hover:'#e8eaf2',text:'#202331',muted:'#606575',secondary:'#404554',border:'#d5d9e5',primary:'#7951ec',cyan:'#157c8a','danger-text':'#b02030'};
      for (const [key,value] of Object.entries(palette)) {
        element.style.setProperty('--palette-'+key,value);
        element.style.setProperty('--rgb-'+key,[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)).join(' '));
      }
    });
    for (const width of [320,393,1024]) {
      await page.setViewportSize({width,height:900});
      await expect(page.locator('app-call-encryption [data-phase="secure"]')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
      const leave=page.getByRole('button',{name:/^(Завершить звонок|Выйти из встречи)$/}).first();
      await expect(leave).toBeInViewport();
      const controls=page.locator('.call-window__controls > button');
      if(await controls.count()) {
        const tops=await controls.evaluateAll(buttons=>buttons.map(button=>Math.round(button.getBoundingClientRect().top)));
        expect(new Set(tops).size).toBe(1);
      }
      await page.screenshot({path:path.join(output,`${name}-${scheme}-${width}.png`)});
    }
  }
  await page.evaluate(({style,scheme})=>{
    if(style===null)document.documentElement.removeAttribute('style');else document.documentElement.setAttribute('style',style);
    if(scheme===undefined)delete document.documentElement.dataset.uiScheme;else document.documentElement.dataset.uiScheme=scheme;
  },original);
  if(viewport)await page.setViewportSize(viewport);
}
module.exports = {root, apiBase, uiBase, fixture, output, api, login, instrument, verify, checkCallLayout};
