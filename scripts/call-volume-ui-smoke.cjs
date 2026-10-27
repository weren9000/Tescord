// UI-to-audio-element checks using a local call fixture; no server accounts or live media.
const {chromium}=require('../desktop/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.KVA_CHROME||'C:/Users/admin/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',headless:true});
 fs.mkdirSync('.local/call-volume',{recursive:true});
 try{
  for(const kind of ['direct','group']){
   const page=await browser.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
   await page.goto(process.env.KVA_UI_URL||'http://127.0.0.1:4217/login');
   await page.waitForFunction(()=>window.ng?.getComponent(document.querySelector('app-root')));
   await page.evaluate(()=>{const a=ng.getComponent(document.querySelector('app-root'));a.session.set({access_token:'local-fixture'});a.currentUser.set({id:'self',nick:'Self',email:'self@example.test'});ng.applyChanges(a)});
   await page.waitForTimeout(700);
   await page.evaluate(kind=>{
    const a=ng.getComponent(document.querySelector('app-root'));
    a.activeServer=()=>({id:'chat',name:'Test call',kind:'direct'});
    a.userAvatarUrl=()=>null;
    a.directCall.peer.set({user_id:'peer',nick:'Собеседник',avatar_updated_at:null});
    a.directCall.state.set('connected');a.directCall.remoteAudioElement=new Audio();
    if(kind==='group'){
     a.activeCallSurface=()=>({kind:'group',id:'group:test',title:'Группа',subtitle:'Звонок',channelId:'test',participantCount:2});
     a.voiceRoom.state.set('connected');
     a.activeCallVoiceParticipants=()=>[{id:'peer',user_id:'peer',nick:'Собеседник',is_self:false,muted:false,owner_muted:false,speaking:false},{id:'self',user_id:'self',nick:'Вы',is_self:true,muted:false,owner_muted:false,speaking:false}];
     a.voiceRoom.remoteAudioOutputs.set('peer',{audioElement:new Audio()});
    }
    a.callWindowMode.set('expanded');ng.applyChanges(a);
   },kind);
   const volume=page.getByRole('slider',{name:'Общая громкость звонка',exact:true});
   await volume.waitFor();
   for(const width of [1440,393,320]){
    await page.setViewportSize({width,height:850});
    for(const mode of ['expanded','minimized']){
     await page.evaluate(mode=>{const a=ng.getComponent(document.querySelector('app-root'));a.callWindowMode.set(mode);ng.applyChanges(a)},mode);
     await volume.press('Home');
     await page.getByText('Звук выключен',{exact:true}).waitFor({state:'visible'});
     assert(await page.getByText('Звук выключен',{exact:true}).isVisible());
     assert.equal(await page.evaluate(kind=>{const a=ng.getComponent(document.querySelector('app-root'));return kind==='direct'?a.directCall.remoteAudioElement.volume:a.voiceRoom.remoteAudioOutputs.get('peer').audioElement.volume},kind),0);
     await page.getByRole('button',{name:'Включить звук звонка',exact:true}).click();
     await page.waitForFunction(()=>document.querySelector('input[aria-label="Общая громкость звонка"]')?.value==='100');
     assert.equal(await volume.inputValue(),'100');
     const box=await volume.boundingBox();
     assert(box&&box.x>=0&&box.x+box.width<=width+1&&box.y+box.height<=850,'Volume stays in viewport');
     await page.mouse.click(box.x+box.width*.45,box.y+box.height/2);
     const value=Number(await volume.inputValue());assert(value>20&&value<70);
     await page.screenshot({path:`.local/call-volume/${kind}-${mode}-${width}.png`});
    }
   }
   if(kind==='group'){
    await page.evaluate(()=>{const a=ng.getComponent(document.querySelector('app-root'));a.callWindowMode.set('expanded');a.conferenceRosterOpen.set(true);ng.applyChanges(a)});
    const personal=page.getByRole('slider',{name:'Громкость участника: Собеседник',exact:true});
    const personalBox=await personal.boundingBox();
    assert(personalBox&&personalBox.x>=0&&personalBox.x+personalBox.width<=321&&personalBox.width>=60,'Personal volume fits mobile roster');
    await personal.press('Home');
    await page.getByText('Заглушён для вас',{exact:true}).waitFor({state:'visible'});
    assert(await page.getByText('Заглушён для вас',{exact:true}).isVisible());
    assert.equal(await page.evaluate(()=>ng.getComponent(document.querySelector('app-root')).voiceRoom.remoteAudioOutputs.get('peer').audioElement.volume),0);
    await page.getByRole('button',{name:'Включить для себя: Собеседник',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('input[aria-label="Громкость участника: Собеседник"]')?.value==='100');
    assert.equal(await personal.inputValue(),'100');
    await personal.press('Home');await personal.press('ArrowRight');
    assert.equal(await personal.inputValue(),'1');
    await page.screenshot({path:'.local/call-volume/participant-320.png'});
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: direct/group, expanded/compact, 1440/393/320px, mouse/keyboard, mute restoration, personal volume');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
