// Local disposable development database only. Real API/WebSocket presence events.
const {chromium, request}=require('../desktop/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const api='http://127.0.0.1:8000/api';
(async()=>{
 const http=await request.newContext();
 assert.equal((await (await http.get(api+'/health')).json()).environment,'development');
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const sockets=[];fs.mkdirSync('.local/voice-ui',{recursive:true});
 try {
  async function post(path,data,token){const r=await http.post(api+path,{data,headers:token?{Authorization:'Bearer '+token}:{}});assert(r.ok(),path+': '+await r.text());return r.json();}
  const admin=await post('/auth/login',{email:'weren9000@kva-chat.local',password:'testing-only-not-for-production'});
  const server=await post('/servers',{name:'Voice UI '+Date.now()},admin.access_token);
  const channels=await (await http.get(api+'/servers/'+server.id+'/channels',{headers:{Authorization:'Bearer '+admin.access_token}})).json();
  const channel=channels.find(c=>c.type==='voice');assert(channel);
  async function presence(token){return new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:8000/api/voice/channels/${channel.id}/ws`);sockets.push(ws);ws.onopen=()=>ws.send(JSON.stringify({type:'authenticate',token}));ws.onmessage=e=>{if(JSON.parse(e.data).type==='room_state')resolve(ws);};ws.onerror=reject;});}
  const first=await presence(admin.access_token);
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let mediaRequests=0;page.on('request',r=>{if(r.url().includes('/sfu-token'))mediaRequests++;});
  await page.goto('http://localhost:4200/login');
  await page.evaluate(value=>localStorage.setItem('tescord.session',JSON.stringify(value)),admin);
  await page.reload();await page.locator('.messenger-shell').waitFor();
  await page.locator('app-section-navigation').getByRole('button',{name:'Площадки',exact:true}).click();
  await page.locator('app-platform-list').getByRole('button',{name:server.name,exact:true}).click();
  const row=page.locator('.space-channel').filter({hasText:channel.name});
  await row.locator('.space-channel__count').getByText('1',{exact:true}).waitFor();
  assert.equal(await row.getAttribute('aria-expanded'),'false');
  assert.equal(await row.locator('.voice-active-dot').count(),1);
  await page.screenshot({path:'.local/voice-ui/desktop-collapsed.png'});
  await row.click();await page.waitForFunction(id=>document.querySelector('[aria-controls="room-roster-'+id+'"]').getAttribute('aria-expanded')==='true',channel.id);
  await page.locator('#room-roster-'+channel.id+' .space-person').waitFor();
  await page.screenshot({path:'.local/voice-ui/desktop-expanded.png'});
  await row.click();await page.waitForFunction(id=>document.querySelector('[aria-controls="room-roster-'+id+'"]').getAttribute('aria-expanded')==='false',channel.id);
  assert.equal(await page.locator('.space-roster-toggle').count(),0);
  first.close();
  await row.locator('.space-channel__count').waitFor({state:'detached'});
  await presence(admin.access_token);
  await row.locator('.space-channel__count').waitFor();
  await page.setViewportSize({width:393,height:852});
  // Open the application's existing mobile sidebar, then use the real room button.
  await page.evaluate(()=>{const app=window.ng.getComponent(document.querySelector('app-root'));app.mobilePanel.set('servers');app.platformBrowserStage.set('channels');});
  await row.click();await page.waitForFunction(id=>document.querySelector('[aria-controls="room-roster-'+id+'"]').getAttribute('aria-expanded')==='true',channel.id);
  assert(await page.locator('.conversation-sidebar--mobile-open').isVisible());
  await row.click();await page.waitForFunction(id=>document.querySelector('[aria-controls="room-roster-'+id+'"]').getAttribute('aria-expanded')==='false',channel.id);
  assert(await row.locator('.voice-active-dot').isVisible());
  await page.screenshot({path:'.local/voice-ui/mobile-collapsed.png'});
  assert.equal(mediaRequests,0);assert.deepEqual(errors,[]);
  console.log('PASS: desktop/mobile roster toggle, live presence count, dot, sidebar preserved, no media join, no page errors');
 } finally {for(const ws of sockets)ws.close();await browser.close();await http.dispose();}
})().catch(e=>{console.error(e);process.exit(1)});
