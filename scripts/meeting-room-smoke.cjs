/* Runs only against a disposable local backend and built frontend. */
const {chromium}=require('../desktop/node_modules/playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const api='http://127.0.0.1:8007',ui='http://127.0.0.1:4207';
const out=path.resolve('.local/meeting-test');
const media=process.env.KVA_MEETING_MEDIA==='1';
async function json(route,method='GET',body,token){const r=await fetch(api+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const result=await r.json();assert.ok(r.ok,JSON.stringify(result));return result;}
(async()=>{
 const suffix=crypto.randomUUID().slice(0,8);
 const account=await json('/api/auth/register','POST',{email:`room_${suffix}@example.test`,nick:`room_${suffix}`,password:'testpass123',password_confirmation:'testpass123'});
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--mute-audio',...(process.env.KVA_TEST_AUDIO?['--use-file-for-fake-audio-capture='+process.env.KVA_TEST_AUDIO]:[])]});
 const ownerCtx=await browser.newContext({permissions:['microphone','camera','clipboard-read','clipboard-write'],viewport:{width:1440,height:1000}});
 const guestCtx=await browser.newContext({permissions:['microphone','camera'],viewport:{width:390,height:844}});
 // A steady calibration sine is not speech; disable capture noise suppression
 // for the test source so it cannot remove the signal being measured.
 for(const context of [ownerCtx,guestCtx])await context.addInitScript(()=>{const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=c=>capture({...c,...(c.audio?{audio:{...(typeof c.audio==='object'?c.audio:{}),echoCancellation:false,noiseSuppression:false,autoGainControl:false}}:{})});});
 await guestCtx.addInitScript(()=>{window.pcs=[];window.RTCPeerConnection=new Proxy(window.RTCPeerConnection,{construct(Target,args){const pc=new Target(...args);window.pcs.push(pc);return pc;}});});
 await ownerCtx.addInitScript(session=>localStorage.setItem('tescord.session',JSON.stringify(session)),account);
 const owner=await ownerCtx.newPage(),guest=await guestCtx.newPage();const errors=[];
 for(const p of [owner,guest])p.on('pageerror',e=>errors.push(e.message));
 try{
  await owner.goto(ui+'/my-room');await owner.getByRole('button',{name:'Начать / вернуться во встречу'}).click();
  await owner.getByRole('button',{name:'Пригласить по ссылке'}).click();
  const link=await owner.getByRole('textbox',{name:'Ссылка на встречу'}).inputValue();
  assert.ok(link.includes('/room/'));
  await owner.keyboard.press('Escape');
  await owner.reload();
  await owner.getByRole('button',{name:'Пригласить по ссылке'}).click();
  assert.equal(await owner.getByRole('textbox',{name:'Ссылка на встречу'}).inputValue(),link,'Invitation survives reload');
  await owner.keyboard.press('Escape');
  await guest.goto(link);await guest.getByRole('textbox',{name:'Ваше имя'}).fill('Гость без аккаунта');
  await guest.getByRole('button',{name:'Присоединиться',exact:true}).click();
  await guest.getByRole('button',{name:'Включить микрофон',exact:true}).waitFor();
  await guest.getByRole('button',{name:'Чат встречи',exact:true}).click();
  await guest.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Привет из гостевой комнаты');
  await guest.getByRole('button',{name:'Отправить',exact:true}).click();
  await owner.locator('.badge.unread').waitFor();
  await owner.getByRole('button',{name:'Чат встречи',exact:true}).click();
  await owner.getByText('Привет из гостевой комнаты',{exact:true}).waitFor();
  await guest.locator('input[type=file]').setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('meeting file')});
  await guest.locator('.reply').filter({hasText:'note.txt'}).waitFor();await guest.getByRole('button',{name:'Отправить',exact:true}).click();
  await owner.getByRole('button',{name:'↓ note.txt'}).waitFor();
  await owner.getByLabel('Действия сообщения').first().click();
  await owner.getByRole('button',{name:'Ответить',exact:true}).first().click();
  await owner.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Ответ владельца');await owner.getByRole('button',{name:'Отправить',exact:true}).click();
  await guest.getByText('Ответ владельца',{exact:true}).waitFor();
  assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(media){
   await owner.getByRole('button',{name:'Включить микрофон',exact:true}).click();
   await guest.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>a.srcObject?.getAudioTracks().length));
   await owner.getByRole('button',{name:'Включить камеру',exact:true}).click();
   await guest.getByRole('button',{name:'Участники',exact:true}).click();
   await guest.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.videoWidth>0));
   assert.equal(await guest.getByRole('slider',{name:'Общая громкость',exact:true}).count(),0);
   await guest.waitForFunction(()=>pcs.flatMap(p=>p.getReceivers()).some(r=>r.track.kind==='audio' && !r.track.muted && r.track.readyState==='live'));
   await guest.evaluate(async()=>{
    const ctx=new AudioContext();await ctx.resume();
    const raw=pcs.flatMap(p=>p.getReceivers()).find(r=>r.track.kind==='audio' && !r.track.muted && r.track.readyState==='live').track;
    window.audioMeters=[new MediaStream([raw]),document.querySelector('audio').srcObject].map(stream=>{const source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();analyser.fftSize=8192;source.connect(analyser);const sink=ctx.createGain();sink.gain.value=0;analyser.connect(sink).connect(ctx.destination);return {ctx,source,analyser,sink};});
   });
   const levels=[];
   for(const value of [100,50,10,0,75]){
    await guest.getByRole('slider',{name:/Громкость: room_/}).fill(String(value));await guest.waitForTimeout(400);
    const rms=await guest.evaluate(()=>audioMeters.map(({analyser})=>{const b=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(b);return Math.sqrt(b.reduce((s,x)=>s+x*x,0)/b.length);}));
    if(rms[0]<=.001)console.log('Audio diagnostics',await guest.evaluate(async()=>({contexts:audioMeters.map(m=>m.ctx.state),tracks:pcs.flatMap(p=>p.getReceivers()).map(r=>({kind:r.track.kind,enabled:r.track.enabled,muted:r.track.muted,state:r.track.readyState})),stats:(await Promise.all(pcs.map(p=>p.getStats()))).flatMap(s=>[...s.values()].filter(x=>x.type==='inbound-rtp' && x.kind==='audio').map(x=>({packets:x.packetsReceived,energy:x.totalAudioEnergy,samples:x.totalSamplesReceived}))),elements:[...document.querySelectorAll('audio')].map(a=>({paused:a.paused,ready:a.readyState,muted:a.muted,tracks:a.srcObject?.getAudioTracks().map(t=>({enabled:t.enabled,muted:t.muted,state:t.readyState}))}))})));assert(rms[0]>.001,'Real incoming audio exists: '+JSON.stringify(rms));assert(Math.abs(rms[1]/rms[0]-value/100)<.07,`Live room PCM ${rms[1]/rms[0]} vs ${value/100}`);levels.push({value,ratio:rms[1]/rms[0]});
   }
   console.log('Live room PCM:',JSON.stringify(levels));
  }
  await owner.screenshot({path:path.join(out,'room-desktop.png'),fullPage:true});await guest.screenshot({path:path.join(out,'room-mobile.png'),fullPage:true});
  await owner.getByRole('button',{name:'Выйти из встречи',exact:true}).click();
  await owner.getByRole('button',{name:'Выйти',exact:true}).click();await guest.getByText(/Владелец отключился/).waitFor();
  await owner.getByRole('button',{name:'Начать / вернуться во встречу'}).click();
  await guest.waitForFunction(()=>!document.querySelector('.owner-away'));
  await owner.getByRole('button',{name:'Выйти из встречи',exact:true}).click();
  await owner.getByRole('button',{name:'Завершить для всех'}).click();
  await guest.getByText('Встреча завершена. Для следующей встречи нужна новая ссылка.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({guestChat:true,files:true,replies:true,ownerReturn:true,endForAll:true,mobileFits:true,media,errors}));
 }catch(error){await owner.screenshot({path:path.join(out,'room-owner-failure.png'),fullPage:true});await guest.screenshot({path:path.join(out,'room-guest-failure.png'),fullPage:true});console.error('Page errors:',errors);throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
