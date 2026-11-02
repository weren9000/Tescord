const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const {execFileSync}=require('node:child_process');
const WebSocket=require('../frontend/node_modules/ws');
const {SignalResponse}=require('../frontend/node_modules/@livekit/protocol');
const {root,apiBase,uiBase,output,api,login,instrument}=require('./encryption-smoke-utils.cjs');
const adb=root+'/.tools/sdk/platform-tools/adb.exe';
const command=(...args)=>execFileSync(adb,args,{timeout:15000});
(async()=>{
 const pid=command('shell','pidof','ru.kvachat.encryptioncheck').toString().trim();
 if(!/^\d+$/.test(pid))throw Error('Isolated Android test app required');
 command('forward','tcp:9229','localabstract:webview_devtools_remote_'+pid);
 command('reverse','tcp:7896','tcp:7896');
 const mobile=await chromium.connectOverCDP('http://127.0.0.1:9229',{noDefaults:true});
 const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--mute-audio']});
 let ticket,guest;
 try{
  const session=await login(0),previous=await api('/rooms/start',session.access_token,{});await api('/rooms/control',previous.token,{action:'end'});
  const context=await browser.newContext();await instrument(context);await context.addInitScript(s=>localStorage.setItem('tescord.session',JSON.stringify(s)),session);
  const owner=await context.newPage();await owner.goto(uiBase+'/my-room');await owner.getByRole('button',{name:'Начать / вернуться во встречу'}).click();
  await expect(owner.locator('app-call-encryption code')).toBeVisible({timeout:15000});
  ticket=await api('/rooms/start',session.access_token,{});ticket.invite=(await api('/rooms/invite',ticket.token,{hours:1,uses:10})).invite;
  guest=mobile.contexts()[0].pages()[0];await instrument(guest.context());
  await guest.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
   const r=await fetch(apiBase+url.pathname+url.search,{method:req.method(),headers:{...req.headers(),host:new URL(apiBase).host},...(req.postDataBuffer()?{body:req.postDataBuffer()}:{})});
   let body=Buffer.from(await r.arrayBuffer());
   if(r.ok && url.pathname==='/api/rooms/media'){const grant=JSON.parse(body);grant.url='wss://encryption-test.invalid';body=Buffer.from(JSON.stringify(grant));}
   await route.fulfill({status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json','access-control-allow-origin':'*'},body});
  });
  await guest.routeWebSocket('wss://encryption-test.invalid/**',socket=>{
   const url=new URL(socket.url()),upstream=new WebSocket('ws://127.0.0.1:7895'+url.pathname+url.search),pending=[];
   socket.onMessage(message=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(message);else pending.push(message);});
   upstream.on('open',()=>{for(const message of pending)upstream.send(message);pending.length=0;});
   upstream.on('message',(data,binary)=>{
    if(binary){
     const signal=SignalResponse.fromBinary(data);
     if(signal.message.case==='trickle')signal.message.value.candidateInit=signal.message.value.candidateInit.replaceAll('127.0.0.1','10.0.2.2');
     if(signal.message.case==='offer')signal.message.value.sdp=signal.message.value.sdp.replaceAll('127.0.0.1','10.0.2.2');
     socket.send(Buffer.from(signal.toBinary()));
    }else socket.send(data.toString());
   });
   upstream.on('error',()=>socket.close());upstream.on('close',()=>socket.close());socket.onClose(()=>upstream.close());
  });
  await guest.goto('https://localhost/room/'+ticket.invite);
  await guest.getByLabel('Ваше имя').fill('Android crypto guest');await guest.getByRole('button',{name:'Присоединиться',exact:true}).click();
  const pages=[owner,guest];
  for(const page of pages)await expect(page.getByRole('button',{name:'Код совпадает у всех',exact:true})).toBeVisible({timeout:20000});
  await expect.poll(async()=>new Set(await Promise.all(pages.map(p=>p.locator('app-call-encryption code').innerText()))).size,{timeout:15000}).toBe(1);
  for(const page of pages)await page.getByRole('button',{name:'Код совпадает у всех',exact:true}).click();
  for(const page of pages)await expect(page.locator('app-call-encryption [data-phase="secure"]')).toBeVisible({timeout:20000});
  await owner.getByRole('button',{name:'Включить микрофон',exact:true}).click();
  await expect.poll(()=>guest.evaluate(()=>window.testPcm()),{timeout:25000}).toBeGreaterThan(.01);
  await owner.getByRole('button',{name:'Включить камеру',exact:true}).click();
  await guest.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.videoWidth>0));
  await guest.screenshot({path:output+'/android-encrypted-call.png'});
  await guest.getByRole('button',{name:'Выйти из встречи',exact:true}).click();
  await guest.waitForFunction(()=>window.testPeers.every(p=>p.connectionState==='closed'));
  console.log('PASS Android WebView: encrypted call verification, actual incoming PCM and video, leave');
 }catch(error){
  if(guest){await guest.screenshot({path:output+'/android-call-failure.png'}).catch(()=>{});console.error('Android test stopped at: '+String(error.stack).split('\n').filter(line=>line.includes('encryption-android-call-smoke.cjs:')).at(-1));}
  throw error;
 }finally{
  if(ticket)await api('/rooms/control',ticket.token,{action:'end'}).catch(()=>{});
  await browser.close();await mobile.close();command('forward','--remove','tcp:9229');command('reverse','--remove','tcp:7896');
 }
})().catch(()=>{console.error('Android encrypted call check failed; no tokens logged.');process.exitCode=1;});
