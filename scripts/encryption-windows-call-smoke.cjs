const {chromium,_electron,expect}=require('../frontend/node_modules/@playwright/test');
const fs=require('node:fs');
const WebSocket=require('../frontend/node_modules/ws');
const {SignalResponse}=require('../frontend/node_modules/@livekit/protocol');
const {root,apiBase,uiBase,output,api,login,instrument}=require('./encryption-smoke-utils.cjs');
(async()=>{
 const env={...process.env,KVA_DESKTOP_TEST:'1',KVA_DESKTOP_TEST_URL:'http://localhost:4200/login',KVA_DESKTOP_PROFILE:fs.mkdtempSync(output+'/windows-call-')};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:root+'/desktop/node_modules/electron/dist/electron.exe',args:[root+'/desktop'],env});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));
 const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--mute-audio']});
 let ticket,guest;
 try{
  const session=await login(0),previous=await api('/rooms/start',session.access_token,{});await api('/rooms/control',previous.token,{action:'end'});
  const context=await browser.newContext();await instrument(context);await context.addInitScript(s=>localStorage.setItem('tescord.session',JSON.stringify(s)),session);
  const owner=await context.newPage();await owner.goto(uiBase+'/my-room');await owner.getByRole('button',{name:'Начать / вернуться во встречу'}).click();
  await expect(owner.locator('app-call-encryption code')).toBeVisible({timeout:15000});
  ticket=await api('/rooms/start',session.access_token,{});ticket.invite=(await api('/rooms/invite',ticket.token,{hours:1,uses:10})).invite;
  guest=await app.firstWindow();await instrument(guest.context());
  await app.evaluate(({net},apiBase)=>{
   const original=net.fetch.bind(net);
   net.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url);
    if(url.origin==='https://kvachat.ru' && url.pathname.startsWith('/api/')){
     const method=typeof input==='string'?'GET':input.method;
     const response=await original(apiBase+url.pathname+url.search,{method,headers:typeof input==='string'?{}:Object.fromEntries(input.headers),...(['GET','HEAD'].includes(method)?{}:{body:await input.arrayBuffer()})});
     if(response.ok && url.pathname==='/api/rooms/media'){const grant=await response.json();grant.url='wss://encryption-test.invalid';return new Response(JSON.stringify(grant),{headers:{'Content-Type':'application/json'}});}
     return response;
    }
    if(url.protocol==='file:')return original(input,options);
    return new Response('',{status:404});
   };
  },apiBase);
  await guest.routeWebSocket('wss://encryption-test.invalid/**',socket=>{
   const url=new URL(socket.url()),upstream=new WebSocket('ws://127.0.0.1:7895'+url.pathname+url.search),pending=[];
   socket.onMessage(message=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(message);else pending.push(message);});
   upstream.on('open',()=>{for(const message of pending)upstream.send(message);pending.length=0;});
   upstream.on('message',(data,binary)=>{
    if(binary){
     const signal=SignalResponse.fromBinary(data);
     socket.send(Buffer.from(signal.toBinary()));
    }else socket.send(data.toString());
   });
   upstream.on('error',()=>socket.close());upstream.on('close',()=>socket.close());socket.onClose(()=>upstream.close());
  });
  await guest.goto('https://kvachat.ru/room/'+ticket.invite);
  await guest.getByLabel('Ваше имя').fill('Windows crypto guest');await guest.getByRole('button',{name:'Присоединиться',exact:true}).click();
  const pages=[owner,guest];
  for(const page of pages)await expect(page.getByRole('button',{name:'Код совпадает у всех',exact:true})).toBeVisible({timeout:20000});
  await expect.poll(async()=>new Set(await Promise.all(pages.map(p=>p.locator('app-call-encryption code').innerText()))).size,{timeout:15000}).toBe(1);
  for(const page of pages)await page.getByRole('button',{name:'Код совпадает у всех',exact:true}).click();
  for(const page of pages)await expect(page.locator('app-call-encryption [data-phase="secure"]')).toBeVisible({timeout:20000});
  await owner.getByRole('button',{name:'Включить микрофон',exact:true}).click();
  await expect.poll(()=>guest.evaluate(()=>window.testPcm()),{timeout:25000}).toBeGreaterThan(.01);
  await owner.getByRole('button',{name:'Включить камеру',exact:true}).click();
  await guest.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.videoWidth>0));
  await guest.screenshot({path:output+'/windows-encrypted-call.png'});
  await guest.getByRole('button',{name:'Выйти из встречи',exact:true}).click();
  await guest.waitForFunction(()=>window.testPeers.every(p=>p.connectionState==='closed'));
  console.log('PASS Windows Electron: encrypted call verification, actual incoming PCM and video, leave');
 }catch(error){
  if(guest){await guest.screenshot({path:output+'/windows-call-failure.png'}).catch(()=>{});console.error('Windows test stopped at: '+String(error.stack).split('\n').filter(line=>line.includes('encryption-windows-call-smoke.cjs:')).at(-1));}
  throw error;
 }finally{
  if(ticket)await api('/rooms/control',ticket.token,{action:'end'}).catch(()=>{});
  await browser.close();await app.close();
 }
})().catch(()=>{console.error('Windows encrypted call check failed; no tokens logged.');process.exitCode=1;});
