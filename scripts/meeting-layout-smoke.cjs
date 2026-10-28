// Disposable Angular development fixture; no production accounts or media.
const {chromium}=require('../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));fs.mkdirSync('.local/room-design',{recursive:true});
 await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 try{
  await page.goto('http://127.0.0.1:4217/my-room');
  await page.waitForFunction(()=>window.ng?.getComponent?.(document.querySelector('app-root')));
  await page.evaluate(()=>{
   const a=ng.getComponent(document.querySelector('app-root'));window.roomFixture=a;
   a.ticket.set({token:'fixture',participant_id:'p0',session_id:'fixture',is_owner:true});a.connected.set(true);a.notice.set('');a.error.set('');a.invite.set(location.origin+'/room/example');
   window.peopleCount=n=>{a.state.set({name:'Моя комната',participants:Array.from({length:n},(_,i)=>({id:'p'+i,name:['Александр','Верен','Анна','Мария','Дмитрий','Очень длинное имя участника встречи'][i%6],is_owner:i===0,silenced:false})),remaining_uses:49,owner_deadline:null});a.page=0;ng.applyChanges(a);};peopleCount(1);
  });
  for(const width of [1440,1024,768,393,320]){
   await page.setViewportSize({width,height:900});
   for(const count of [1,2,6,50]){
    await page.evaluate(n=>peopleCount(n),count);
    assert.equal(await page.locator('.participant-tile').count(),Math.min(count,9));
    const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,vertical:document.documentElement.scrollHeight>innerHeight+1,buttons:[...document.querySelectorAll('.meeting-toolbar button')].filter(b=>b.getBoundingClientRect().width).map(b=>{const r=b.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}})}));
    assert(!layout.overflow&&!layout.vertical,`No page overflow at ${width}/${count}`);
    assert(layout.buttons.every(b=>b.x>=0&&b.right<=width&&b.bottom<=900&&b.w>=44&&b.h>=44));
    assert(Math.max(...layout.buttons.map(b=>b.y))-Math.min(...layout.buttons.map(b=>b.y))<1,'Toolbar buttons align');
    if([1,6].includes(count))await page.screenshot({path:`.local/room-design/room-${width}-${count}.png`});
   }
   await page.getByRole('button',{name:'Участники',exact:true}).click();
   const slider=await page.getByRole('slider').first().boundingBox();assert(slider.width>=140,`Wide personal slider at ${width}`);
   if([1440,393].includes(width))await page.screenshot({path:`.local/room-design/participants-${width}.png`});
   await page.getByRole('button',{name:'Чат встречи',exact:true}).click();await page.locator('.composer').waitFor();assert.equal(await page.getByRole('slider').count(),0);
   await page.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Черновик');
   await page.getByRole('button',{name:'Участники',exact:true}).click();await page.getByRole('button',{name:'Чат встречи',exact:true}).click();
   assert.equal(await page.getByRole('textbox',{name:'Сообщение',exact:true}).inputValue(),'Черновик');
   if([1440,393].includes(width))await page.screenshot({path:`.local/room-design/chat-${width}.png`});
   await page.getByRole('button',{name:'Закрыть панель'}).click();
  }
  await page.getByRole('button',{name:'Пригласить по ссылке'}).click();await page.getByRole('button',{name:'Скопировать ссылку',exact:true}).click();await page.getByText('Ссылка скопирована',{exact:true}).waitFor();
  assert((await page.evaluate(()=>navigator.clipboard.readText())).endsWith('/room/example'));await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Настройки встречи',exact:true}).click();await page.getByRole('dialog',{name:'Настройки встречи'}).waitFor();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Выйти из встречи'}).click();await page.getByRole('button',{name:'Завершить для всех',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>{peopleCount(6);const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const c=canvas.getContext('2d');c.fillStyle='#243344';c.fillRect(0,0,1280,720);c.fillStyle='white';c.font='36px sans-serif';c.fillText('Демонстрация экрана',80,120);const stream=canvas.captureStream();const track={attach:el=>{el.srcObject=stream;void el.play();},detach:el=>{el.srcObject=null;}};window.screenTrack=track;roomFixture.videos.set([{id:'screen',participant:'p0',name:'Александр',screen:true,track}]);ng.applyChanges(roomFixture);});
  assert.equal(await page.locator('.participant-tile').count(),0);
  const stage=await page.locator('.stage').boundingBox(),screen=await page.locator('.presentation').boundingBox();assert(Math.abs(stage.width-screen.width)<1);
  await page.screenshot({path:'.local/room-design/presentation.png'});
  await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const c=canvas.getContext('2d');c.fillStyle='#36735b';c.fillRect(0,0,640,480);c.fillStyle='white';c.font='40px sans-serif';c.fillText('Camera',60,100);window.cameraStream=canvas.captureStream();window.cameraTrack={attach:el=>{el.srcObject=cameraStream;void el.play();},detach:el=>{el.srcObject=null;}};window.cameraVideos=[{id:'camera0',participant:'p0',name:'Owner',screen:false,track:cameraTrack},{id:'camera1',participant:'p1',name:'Guest',screen:false,track:cameraTrack}];roomFixture.videos.set([...roomFixture.videos(),...cameraVideos]);ng.applyChanges(roomFixture);});
  for(const width of [1440,1024,768,393,320]){
   await page.setViewportSize({width,height:900});assert.equal(await page.locator('.participant-tile').count(),2);
   await page.waitForFunction(()=>[...document.querySelectorAll('.stage video')].every(v=>v.videoWidth>0));
   assert(await page.evaluate(()=>document.querySelector('.presentation video').srcObject!==document.querySelector('.participant-tile video').srcObject),'Screen and camera have independent streams');
   const boxes=await page.locator('.stage video').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};}));
   assert(boxes.every(r=>r.w>80&&r.h>60&&r.x>=0&&r.y>=0&&r.right<=width+1&&r.bottom<=900),'Camera and screen fit viewport');
   await page.screenshot({path:`.local/room-design/screen-cameras-${width}.png`});
   await page.getByRole('button',{name:'Скрыть камеры',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.participant-tile').length===0);assert.equal(await page.locator('.participant-tile').count(),0);
   await page.getByRole('button',{name:'Показать камеры',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.participant-tile').length===2);assert.equal(await page.locator('.participant-tile').count(),2);
  }
  // Camera enabled before sharing, disabled during sharing, and screen restart.
  await page.evaluate(()=>{roomFixture.videos.set(cameraVideos);ng.applyChanges(roomFixture);});assert.equal(await page.locator('.participant-tile').count(),6);
  await page.evaluate(()=>{roomFixture.videos.set([...cameraVideos,{id:'screen',participant:'p0',name:'Owner',screen:true,track:screenTrack}]);ng.applyChanges(roomFixture);});assert.equal(await page.locator('.participant-tile').count(),2);
  await page.evaluate(()=>{roomFixture.videos.set(roomFixture.videos().filter(v=>v.screen));ng.applyChanges(roomFixture);});assert.equal(await page.locator('.participant-tile').count(),0);
  await page.evaluate(()=>{roomFixture.videos.set([]);ng.applyChanges(roomFixture);});assert.equal(await page.locator('.participant-tile').count(),6);
  await page.evaluate(()=>peopleCount(50));await page.getByRole('button',{name:'Следующие участники',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.pages span')?.textContent==='2');assert.equal(await page.locator('.pages span').innerText(),'2');
  await page.evaluate(()=>peopleCount(1));assert.equal(await page.locator('.participant-tile').count(),1);

  await page.setViewportSize({width:393,height:470});await page.getByRole('button',{name:'Чат встречи',exact:true}).click();
  const send=await page.getByRole('button',{name:'Отправить',exact:true}).boundingBox();assert(send.y>=0&&send.y+send.height<=470,'Composer fits reduced keyboard viewport');
  assert.deepEqual(errors,[]);console.log('PASS: 1/2/6/50 people, 5 widths, toolbar, personal sliders, draft, invitation, dialogs, presentation, keyboard viewport');
 }catch(e){await page.screenshot({path:'.local/room-design/failure.png'});console.log(await page.locator('#meeting-invite').evaluate(el=>({html:el.outerHTML,open:el.matches(':popover-open'),display:getComputedStyle(el).display})));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
