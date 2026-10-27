// Measures real PCM through production playback classes and the Angular UI.
const {chromium}=require('../desktop/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.KVA_CHROME||'C:/Users/admin/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
 fs.mkdirSync('.local/participant-audio',{recursive:true});
 try{
  for(const kind of ['direct','group']){
   const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
   await page.goto(process.env.KVA_UI_URL||'http://127.0.0.1:4217/login');
   await page.waitForFunction(()=>window.ng?.getComponent?.(document.querySelector('app-root')));
   await page.evaluate(()=>{const a=ng.getComponent(document.querySelector('app-root'));a.session.set({access_token:'fixture'});a.currentUser.set({id:'self',nick:'Вы',email:'self@example.test'});ng.applyChanges(a)});
   await page.waitForTimeout(600);
   await page.evaluate(async kind=>{
    const a=ng.getComponent(document.querySelector('app-root')),ctx=new AudioContext();await ctx.resume();
    const tone=f=>{const o=ctx.createOscillator(),g=ctx.createGain(),d=ctx.createMediaStreamDestination();o.frequency.value=f;g.gain.value=.15;o.connect(g).connect(d);o.start();return {kind:'audio',mediaStreamTrack:d.stream.getAudioTracks()[0]};};
    window.tones=[tone(440),tone(880),tone(1320)];window.fixtureContext=ctx;
    a.activeServer=()=>({id:'chat',name:'Test call',kind:'direct'});a.userAvatarUrl=()=>null;
    a.directCall.peer.set({user_id:'peer',nick:'Тестер 2 апреля',avatar_updated_at:null});a.directCall.state.set('connected');
    const sdk={Track:{Kind:{Audio:'audio',Video:'video'},Source:{Camera:'camera',ScreenShare:'screen_share'}}};
    if(kind==='group'){
     a.activeCallSurface=()=>({kind:'group',id:'group:test',title:'Группа',subtitle:'Звонок',channelId:'test',participantCount:3});
     a.voiceRoom.state.set('connected');a.voiceRoom.sdk=sdk;
     a.activeCallVoiceParticipants=()=>[{id:'self',user_id:'self',nick:'Вы',is_self:true,muted:false,owner_muted:false,speaking:false},{id:'peer',user_id:'peer',nick:'Тестер 2 апреля',is_self:false,muted:false,owner_muted:false,speaking:true},{id:'other',user_id:'other',nick:'Второй участник',is_self:false,muted:true,owner_muted:false,speaking:false}];
     await a.voiceRoom.attachRemoteAudio('peer',tones[0]);await a.voiceRoom.attachRemoteAudio('other',tones[1]);a.voiceRoom.updateMasterVolume(0);a.conferenceRosterOpen.set(true);
    }else{a.directCall.sdk=sdk;a.directCall.attachTrack(tones[0],'microphone');}
    window.bindMeters=()=>{
     window.meters?.forEach(x=>{x.source.disconnect();x.analyser.disconnect();});
     const elements=kind==='group'?[a.voiceRoom.remoteAudioOutputs.get('peer').audioElement,a.voiceRoom.remoteAudioOutputs.get('other').audioElement]:[a.directCall.remoteAudioElement];
     window.meters=elements.map(el=>{const source=ctx.createMediaStreamSource(el.srcObject),analyser=ctx.createAnalyser();analyser.fftSize=4096;source.connect(analyser);return {source,analyser};});
    };
    bindMeters();a.callWindowMode.set('expanded');ng.applyChanges(a);
   },kind);
   const measure=async()=>{await page.waitForTimeout(250);return page.evaluate(()=>meters.map(({analyser})=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length);}));};
   // Allow the media-element/Web Audio pipeline to fill before recording the
   // baseline; startup samples can contain a partly empty analysis window.
   await page.waitForTimeout(1200);
   const base=await measure();assert(base[0]>.02,'Audible PCM baseline exists');
   const slider=page.getByRole('slider',{name:kind==='group'?'Громкость участника: Тестер 2 апреля':'Громкость собеседника',exact:true});
   await slider.waitFor();assert.equal(await page.getByRole('slider',{name:/Общая громкость/}).count(),0);
   for(const value of [50,10,0,100]){
    await slider.fill(String(value));const rms=await measure();
    assert(Math.abs(rms[0]/base[0]-value/100)<.035,`${kind}: PCM ratio ${rms[0]/base[0]} vs ${value/100}`);
    if(kind==='group')assert(Math.abs(rms[1]/base[1]-1)<.035,'Second participant unaffected');
   }
   if(kind==='group'){
    await page.evaluate(async()=>{const a=ng.getComponent(document.querySelector('app-root'));await a.voiceRoom.attachRemoteAudio('peer',tones[2]);bindMeters();});
    const both=await measure();assert(both[0]>base[0]*1.3,'Microphone and screen audio mix');
    await slider.fill('50');assert(Math.abs((await measure())[0]/both[0]-.5)<.035);
    await page.evaluate(()=>ng.getComponent(document.querySelector('app-root')).voiceRoom.handleTrackUnsubscribed(tones[2],undefined,'peer'));
    await page.waitForTimeout(100);await page.evaluate(()=>bindMeters());assert(Math.abs((await measure())[0]/base[0]-.5)<.035,'Unsubscribe preserves microphone');
    await page.getByRole('button',{name:'Заглушить для себя: Тестер 2 апреля',exact:true}).click();assert((await measure())[0]<.0001);
    await page.getByRole('button',{name:'Включить для себя: Тестер 2 апреля',exact:true}).click();assert(Math.abs((await measure())[0]/base[0]-.5)<.035);
    await page.getByRole('button',{name:'Меню участника: Тестер 2 апреля',exact:true}).click();
    await page.getByRole('slider',{name:'Громкость Тестер 2 апреля',exact:true}).fill('23');assert(Math.abs((await measure())[0]/base[0]-.23)<.035);await page.keyboard.press('Escape');
    await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('QuotaExceededError');};});await slider.fill('70');assert(Math.abs((await measure())[0]/base[0]-.7)<.035);
   }
   for(const width of [1440,393,320]){
    await page.setViewportSize({width,height:900});const box=await slider.boundingBox();assert(box&&box.width>=140&&box.x>=0&&box.x+box.width<=width+1,`Usable slider at ${width}: ${JSON.stringify(box)}`);
    await page.mouse.click(box.x+box.width*.36,box.y+box.height/2);const level=Number(await slider.inputValue());assert(level>20&&level<55);assert(Math.abs((await measure())[0]/base[0]-level/100)<.035);
    await page.screenshot({path:`.local/participant-audio/${kind}-${width}.png`});
   }
   assert.deepEqual(errors,[]);await page.close();console.log('PASS:',kind,'PCM gain, mouse, desktop/mobile layout');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
