const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const fs=require('node:fs');
const testContext=require('./encryption-smoke-utils.cjs');
(async()=>{
 const fixture=testContext.fixture;
 const api=async(path,token,body)=>{const r=await fetch(testContext.apiBase+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body??{})});if(!r.ok)throw Error(path+' '+r.status);return r.json();};
 const session=await api('/auth/login',null,{email:fixture.users[0].email,password:'local-test-only-password'});
 const previous=await api('/rooms/start',session.access_token,{});
 await api('/rooms/control',previous.token,{action:'end'});
 const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--mute-audio']});
 const pages=[];
 let releaseKeys = () => {};
 const secure = async clients => {
  for (const page of clients) {
   await expect(page.locator('app-call-encryption code')).toHaveCount(0);
   await expect(page.getByRole('button',{name:'Код совпадает у всех',exact:true})).toHaveCount(0);
   await expect(page.locator('app-call-encryption [data-phase="secure"]')).toBeVisible({timeout:20000});
  }
 };
 const audible = async clients => {
  for(const page of clients)await expect.poll(()=>page.evaluate(()=>window.pcm()),{timeout:15000}).toBeGreaterThan(.01);
 };
 const instrument=async context=>context.addInitScript(()=>{
  window.pcs=[];const Native=RTCPeerConnection;window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);window.pcs.push(this);}};
  const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async constraints=>{if(!constraints.audio)return gum(constraints);const ctx=new AudioContext();await ctx.resume();const source=ctx.createOscillator(),dest=ctx.createMediaStreamDestination();source.frequency.value=440;source.connect(dest);source.start();window.testAudio=ctx;return dest.stream;};
  navigator.mediaDevices.getDisplayMedia=()=>gum({video:true,audio:false});
  window.pcm=async()=>{const track=window.pcs.filter(pc=>pc.connectionState==='connected').flatMap(pc=>pc.getReceivers()).find(r=>r.track.kind==='audio' && r.track.readyState==='live')?.track;if(!track)return 0;if(!window.meter || window.meter.track!==track){const ctx=new AudioContext();await ctx.resume();const src=ctx.createMediaStreamSource(new MediaStream([track])),analyser=ctx.createAnalyser();analyser.fftSize=2048;src.connect(analyser);window.meter={ctx,track,src,analyser};}const b=new Float32Array(2048);window.meter.analyser.getFloatTimeDomainData(b);return Math.sqrt(b.reduce((a,x)=>a+x*x,0)/b.length);};
 });
 try {
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await instrument(context);
 await context.addInitScript(s=>localStorage.setItem('tescord.session',JSON.stringify(s)),session);
 const owner=await context.newPage();pages.push(owner);
 for(const page of pages)page.on('pageerror',e=>console.log('PAGE',e.message));
 await owner.goto(testContext.uiBase+'/my-room');
 await owner.getByRole('button',{name:'Начать / вернуться во встречу'}).click();
 await owner.waitForTimeout(2000);
 const ticket=await api('/rooms/start',session.access_token,{});
 ticket.invite=(await api('/rooms/invite',ticket.token,{uses:100,hours:1})).invite;
 const guestContext=await browser.newContext({viewport:{width:393,height:852}});await instrument(guestContext);const guest=await guestContext.newPage();pages.push(guest);
 guest.on('pageerror',e=>console.log('PAGE',e.message));
 await guest.goto(testContext.uiBase+'/room/'+ticket.invite);
 await guest.getByLabel('Ваше имя').fill('Crypto guest');
 await guest.getByRole('button',{name:'Присоединиться',exact:true}).click();
 await secure(pages);
 for(const page of pages)await page.getByRole('button',{name:'Включить микрофон',exact:true}).click();
 await audible(pages);
 await guest.getByRole('button',{name:'Звонок зашифрован',exact:true}).click();
 await expect(guest.locator('.call-encryption-detail')).toBeVisible();
 await guest.keyboard.press('Escape');
 await expect(guest.locator('.call-encryption-detail')).toBeHidden();
 // A temporary signaling outage recovers automatically without confirmation.
 await guest.route('**/api/media-encryption/state',route=>route.fulfill({status:503,body:'{}'}));
 await expect(guest.locator('app-call-encryption [data-phase="error"]')).toBeVisible({timeout:10000});
 await guest.unroute('**/api/media-encryption/state');
 await secure(pages);
 await audible(pages);
 await owner.getByRole('button',{name:'Включить камеру',exact:true}).click();
 await guest.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.videoWidth>0));
 await owner.getByRole('button',{name:'Показать экран',exact:true}).click();
 await expect(guest.locator('.stage.presenting')).toBeVisible();
 await owner.getByRole('button',{name:'Остановить показ',exact:true}).click();
 await expect(guest.locator('.stage.presenting')).toHaveCount(0);
 await testContext.checkCallLayout(guest,'room-auto');
 // Pause key delivery during a membership change: old receive keys must stop playing.
 const thirdContext=await browser.newContext();await instrument(thirdContext);const third=await thirdContext.newPage();pages.push(third);
 const keyGate=new Promise(resolve=>{releaseKeys=resolve;});
 for(const page of pages)await page.route('**/api/media-encryption/envelopes',async route=>{await keyGate;await route.continue().catch(()=>{});});
 await third.goto(testContext.uiBase+'/room/'+ticket.invite);await third.getByLabel('Ваше имя').fill('Crypto newcomer');await third.getByRole('button',{name:'Присоединиться',exact:true}).click();
 for(const page of [owner,guest])await expect(page.locator('app-call-encryption [data-phase="waiting"]')).toBeVisible({timeout:12000});
 for(const page of [owner,guest])await expect.poll(()=>page.evaluate(()=>window.pcm()),{timeout:10000}).toBeLessThan(.001);
 releaseKeys();
 await secure(pages);await audible(pages);
 await third.getByRole('button',{name:'Выйти из встречи',exact:true}).click();
 await expect(third.locator('app-call-encryption')).toHaveCount(0);
 await secure([owner,guest]);await audible([owner,guest]);
 // Re-entering creates a fresh ephemeral device; no manual action on other clients.
 await third.getByRole('button',{name:'Присоединиться',exact:true}).click();
 await secure(pages);await audible(pages);
 // Replacing an existing device key in the directory must fail closed.
 await third.route('**/api/media-encryption/state',async route=>{
  const response=await route.fetch();const body=await response.json();
  const device=body.devices.find(d=>d.id!==route.request().headers()['x-media-device']);
  device.device_keys.keys['curve25519:'+device.id]='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  await route.fulfill({response,json:body});
 });
 await third.waitForFunction(()=>window.pcs.every(pc=>pc.connectionState==='closed'),{timeout:15000});
 await expect(third.getByRole('alert').filter({visible:true})).toContainText('Не удалось проверить защиту звонка');
 await secure([owner,guest]);await audible([owner,guest]);
 await owner.getByRole('button',{name:'Выйти из встречи',exact:true}).click();await owner.getByRole('button',{name:'Завершить для всех',exact:true}).click();
 for(const page of pages)await page.waitForFunction(()=>window.pcs.every(p=>p.connectionState==='closed'));
 console.log('PASS auto-approved room: PCM, camera, screen, 320/393/1024, retry, rekey silence, third participant, leave/rejoin, key substitution rejected');
 }catch(e){for(let i=0;i<pages.length;i++){await pages[i].screenshot({path:'.local/call-crypto-failure-'+i+'.png'});}throw e;}finally{releaseKeys();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
