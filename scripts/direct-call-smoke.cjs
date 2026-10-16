const {chromium}=require('../desktop/node_modules/playwright');
const fs=require('node:fs');
const fixture=JSON.parse(fs.readFileSync(process.env.KVA_TEST_FIXTURE,'utf8'));
const base=process.env.KVA_TEST_BASE || 'http://localhost:4200';
async function launch() {
 const args=['--disable-features=LocalNetworkAccessChecks','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'];
 if(process.env.KVA_TEST_ELECTRON==='1') {
  const {_electron}=require('../desktop/node_modules/playwright'),os=require('node:os'),path=require('node:path'),apps=[];
  return {
   async newContext(){
    const env={...process.env,KVA_DESKTOP_TEST:'1',KVA_DESKTOP_TEST_URL:'http://localhost:4200/login',KVA_DESKTOP_PROFILE:fs.mkdtempSync(path.join(os.tmpdir(),'kva-direct-call-'))};
    delete env.ELECTRON_RUN_AS_NODE;
    const app=await _electron.launch({args:[path.resolve(__dirname,'../desktop'),...args],env});apps.push(app);
    return {async newPage(){const page=await app.firstWindow();await page.getByLabel('Email',{exact:true}).waitFor();return page;}};
   },
   async close(){for(const app of apps)await app.close();}
  };
 }
 return chromium.launch({executablePath:process.env.KVA_CHROME||'C:/Users/admin/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',headless:true,args});
}
(async()=>{const browser=await launch();try{
 const pages=[];
 for(let i=0;i<2;i++){
  const context=await browser.newContext();const page=await context.newPage();pages.push(page);
  await page.addInitScript(({delay})=>{
   window.testToneStarts=0;window.testToneActive=0;
   const oscillator=AudioContext.prototype.createOscillator;
   AudioContext.prototype.createOscillator=function(){const node=oscillator.call(this),start=node.start.bind(node);node.start=(...args)=>{window.testToneStarts++;window.testToneActive++;return start(...args);};node.addEventListener('ended',()=>window.testToneActive--);return node;};
   window.testPeers=[];const Peer=window.RTCPeerConnection;window.RTCPeerConnection=class extends Peer{constructor(...args){super(...args);window.testPeers.push(this);}};
   window.testControlSockets=[];const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(...args){super(...args);if(String(args[0]).includes('/calls/ws'))window.testControlSockets.push(this);}};
   const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{if(delay)await new Promise(r=>setTimeout(r,delay));return gum(c);};
   navigator.mediaDevices.getDisplayMedia=()=>gum({video:true,audio:false});
  },{delay:i===1?2000:0});
  page.on('pageerror',e=>console.log('PAGE ERROR',i,e.message));
  page.on('websocket',ws=>{if(ws.url().includes('/calls/ws'))ws.on('framereceived',frame=>{try{const v=JSON.parse(frame.payload);console.log('SIGNAL',i,v.type,v.detail||'');}catch{}});});
  await page.goto(base+'/login',{waitUntil:'domcontentloaded'});await page.getByLabel('Email',{exact:true}).fill(fixture.users[i].form.email);await page.getByLabel('Пароль',{exact:true}).fill(fixture.users[i].form.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('app-section-navigation').waitFor();
 }
 const [a,b]=pages;await a.locator('app-section-navigation').getByRole('button',{name:'Друзья',exact:true}).click();await a.locator('app-conversation-list').getByRole('button',{name:fixture.users[1].user.nick,exact:true}).click();await a.getByRole('button',{name:'Позвонить',exact:true}).first().click();
 await b.getByRole('button',{name:'Ответить',exact:true}).first().waitFor();
 for(const page of pages)await page.waitForFunction(()=>window.testToneStarts>0);
 await b.getByRole('button',{name:'Ответить',exact:true}).first().click();
 for(const page of pages){await page.waitForFunction(()=>window.testPeers.some(p=>p.connectionState==='connected'),{},{timeout:20000});}
 await new Promise(r=>setTimeout(r,2500));
 for(let i=0;i<pages.length;i++){
  const stats=await pages[i].evaluate(async()=>{const peers=window.testPeers.filter(p=>p.connectionState==='connected');const reports=(await Promise.all(peers.map(p=>p.getStats()))).flatMap(r=>[...r.values()]);return{senders:peers.flatMap(p=>p.getSenders()).filter(s=>s.track?.kind==='audio').length,inbound:reports.filter(v=>v.type==='inbound-rtp'&&v.kind==='audio').reduce((sum,v)=>sum+(v.bytesReceived||0),0)};});
  console.log('MEDIA',i,stats);if(!stats.senders||!stats.inbound)throw Error('Missing bidirectional audio for participant '+i);
  if(await pages[i].evaluate(()=>window.testToneActive!==0))throw Error('Ringtone continued after answer');
 }
 await a.getByRole('button',{name:'Включить камеру',exact:true}).first().click();
 await b.waitForFunction(()=>[...document.querySelectorAll('.direct-call-video-stage video')].some(v=>v.videoWidth>0));
 await a.getByRole('button',{name:'Показать экран',exact:true}).first().click();
 await b.waitForFunction(()=>[...document.querySelectorAll('.direct-call-screen video')].some(v=>v.videoWidth>0));
 await a.getByRole('button',{name:'Остановить показ экрана',exact:true}).first().click();
 await b.waitForFunction(()=>document.querySelectorAll('.direct-call-screen video').length===0);
 await a.evaluate(()=>window.testControlSockets.at(-1).close());
 await a.waitForFunction(()=>window.testControlSockets.length>=2 && window.testControlSockets.at(-1).readyState===1);
 await new Promise(r=>setTimeout(r,1000));
 await a.getByRole('button',{name:'Выключить камеру',exact:true}).first().click();
 await a.getByRole('button',{name:'Завершить звонок',exact:true}).first().click();
 for(const page of pages)await page.waitForFunction(()=>window.testPeers.every(p=>p.connectionState==='closed'));
 console.log('PASS: private SFU call, delayed microphone, bidirectional RTP, ringtone, camera, screen, control reconnect, hangup');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
