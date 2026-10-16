const {chromium}=require('../desktop/node_modules/playwright');
const fs=require('node:fs');
const fixture=JSON.parse(fs.readFileSync(process.env.KVA_TEST_FIXTURE,'utf8'));
(async()=>{const browser=await chromium.launch({executablePath:process.env.KVA_CHROME||'C:/Users/admin/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',headless:true,args:['--disable-features=LocalNetworkAccessChecks','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});try{
 const pages=[];
 for(let i=0;i<2;i++){
  const context=await browser.newContext();const page=await context.newPage();pages.push(page);
  await page.addInitScript(({delay})=>{
   window.testToneStarts=0;window.testToneActive=0;
   const oscillator=AudioContext.prototype.createOscillator;
   AudioContext.prototype.createOscillator=function(){const node=oscillator.call(this),start=node.start.bind(node);node.start=(...args)=>{window.testToneStarts++;window.testToneActive++;return start(...args);};node.addEventListener('ended',()=>window.testToneActive--);return node;};
   window.testPeers=[];const Peer=window.RTCPeerConnection;window.RTCPeerConnection=class extends Peer{constructor(...args){super(...args);window.testPeers.push(this);}};
   const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{if(delay)await new Promise(r=>setTimeout(r,delay));return gum(c);};
  },{delay:i===1?2000:0});
  page.on('pageerror',e=>console.log('PAGE ERROR',i,e.message));
  page.on('websocket',ws=>{if(ws.url().includes('/calls/ws'))ws.on('framereceived',frame=>{try{const v=JSON.parse(frame.payload);console.log('SIGNAL',i,v.type,v.detail||'');}catch{}});});
  await page.goto('http://localhost:4200/login');await page.getByLabel('Email',{exact:true}).fill(fixture.users[i].form.email);await page.getByLabel('Пароль',{exact:true}).fill(fixture.users[i].form.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('app-section-navigation').waitFor();
 }
 const [a,b]=pages;await a.locator('app-section-navigation').getByRole('button',{name:'Друзья',exact:true}).click();await a.locator('app-conversation-list').getByRole('button',{name:fixture.users[1].user.nick,exact:true}).click();await a.getByRole('button',{name:'Позвонить',exact:true}).first().click();
 await b.getByRole('button',{name:'Ответить',exact:true}).first().waitFor();
 for(const page of pages)await page.waitForFunction(()=>window.testToneStarts>0);
 await b.getByRole('button',{name:'Ответить',exact:true}).first().click();
 for(const page of pages){await page.waitForFunction(()=>window.testPeers.some(p=>p.connectionState==='connected'),{},{timeout:20000});}
 await new Promise(r=>setTimeout(r,2500));
 for(let i=0;i<pages.length;i++){
  const stats=await pages[i].evaluate(async()=>{const p=window.testPeers.find(p=>p.connectionState==='connected');return{senders:p.getSenders().filter(s=>s.track?.kind==='audio').length,inbound:[...await p.getStats()].map(v=>v[1]).filter(v=>v.type==='inbound-rtp'&&v.kind==='audio').reduce((sum,v)=>sum+(v.bytesReceived||0),0)};});
  console.log('MEDIA',i,stats);if(!stats.senders||!stats.inbound)throw Error('Missing bidirectional audio for participant '+i);
  if(await pages[i].evaluate(()=>window.testToneActive!==0))throw Error('Ringtone continued after answer');
 }
 await a.getByRole('button',{name:'Завершить звонок',exact:true}).first().click();
 for(const page of pages)await page.waitForFunction(()=>window.testPeers.every(p=>p.connectionState==='closed'));
 console.log('PASS: two friend accounts, delayed microphone permission, bidirectional RTP audio, ringtone stops, hangup');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
