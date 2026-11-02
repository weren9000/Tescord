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
 for(const page of pages)await expect(page.locator('app-call-encryption [data-phase="verify"]')).toBeVisible({timeout:20000});
 for(const page of pages)await page.getByRole('button',{name:'Включить микрофон',exact:true}).click();
 await owner.waitForTimeout(1000);for(const page of pages)expect(await page.evaluate(()=>window.pcm())).toBeLessThan(.001);
 const codes=await Promise.all(pages.map(p=>p.locator('app-call-encryption code').innerText()));expect(codes[0]).toBe(codes[1]);
 for(const page of pages)await page.getByRole('button',{name:'Код совпадает у всех',exact:true}).click();
 for(const page of pages)await expect(page.locator('app-call-encryption [data-phase="secure"]')).toBeVisible({timeout:20000});
 for(const page of pages)await expect.poll(()=>page.evaluate(()=>window.pcm()),{timeout:15000}).toBeGreaterThan(.01);
 await owner.getByRole('button',{name:'Включить камеру',exact:true}).click();
 await guest.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.videoWidth>0));
 await owner.getByRole('button',{name:'Показать экран',exact:true}).click();
 await expect(guest.locator('.stage.presenting')).toBeVisible();
 await owner.getByRole('button',{name:'Остановить показ',exact:true}).click();
 await expect(guest.locator('.stage.presenting')).toHaveCount(0);
 for(const width of [320,393,1024]){await guest.setViewportSize({width,height:900});expect(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await guest.screenshot({path:'.local/call-crypto-'+width+'.png'});}
 // A new guest invalidates verification and triggers fresh sender keys.
 const thirdContext=await browser.newContext();await instrument(thirdContext);const third=await thirdContext.newPage();pages.push(third);
 await third.goto(testContext.uiBase+'/room/'+ticket.invite);await third.getByLabel('Ваше имя').fill('Crypto newcomer');await third.getByRole('button',{name:'Присоединиться',exact:true}).click();
 for(const page of pages)await expect(page.locator('app-call-encryption [data-phase="verify"]')).toBeVisible({timeout:12000});
 await owner.waitForTimeout(700);for(const page of [owner,guest])expect(await page.evaluate(()=>window.pcm())).toBeLessThan(.001);
 const changed=await Promise.all(pages.map(p=>p.locator('app-call-encryption code').innerText()));expect(new Set(changed).size).toBe(1);expect(changed[0]).not.toBe(codes[0]);
 for(const page of pages)await page.getByRole('button',{name:'Код совпадает у всех',exact:true}).click();
 for(const page of pages)await expect(page.locator('app-call-encryption [data-phase="secure"]')).toBeVisible({timeout:15000});
 for(const page of pages)await expect.poll(()=>page.evaluate(()=>window.pcm()),{timeout:15000}).toBeGreaterThan(.01);
 await third.getByRole('button',{name:'Выйти из встречи',exact:true}).click();
 for(const page of [owner,guest])await expect(page.locator('app-call-encryption [data-phase="verify"]')).toBeVisible({timeout:12000});
 for(const page of [owner,guest])await page.getByRole('button',{name:'Код совпадает у всех',exact:true}).click();
 for(const page of [owner,guest])await expect.poll(()=>page.evaluate(()=>window.pcm()),{timeout:15000}).toBeGreaterThan(.01);
 // Re-entering creates a fresh ephemeral device and another verification code.
 await third.getByRole('button',{name:'Присоединиться',exact:true}).click();
 for(const page of pages)await expect(page.locator('app-call-encryption [data-phase="verify"]')).toBeVisible({timeout:12000});
 for(const page of pages)await page.getByRole('button',{name:'Код совпадает у всех',exact:true}).click();
 for(const page of pages)await expect(page.locator('app-call-encryption [data-phase="secure"]')).toBeVisible({timeout:15000});
 for(const page of pages)await expect.poll(()=>page.evaluate(()=>window.pcm()),{timeout:15000}).toBeGreaterThan(.01);
 await owner.getByRole('button',{name:'Выйти из встречи',exact:true}).click();await owner.getByRole('button',{name:'Завершить для всех',exact:true}).click();
 for(const page of pages)await page.waitForFunction(()=>window.pcs.every(p=>p.connectionState==='closed'));
 console.log('PASS encrypted room: pre-verification silence, PCM, camera, screen, 320/393/1024, third participant rekey, leave/rejoin, end');
 }catch(e){for(let i=0;i<pages.length;i++){console.log('UI',i,(await pages[i].locator('body').innerText()).slice(0,1800));await pages[i].screenshot({path:'.local/call-crypto-failure-'+i+'.png'});}throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
