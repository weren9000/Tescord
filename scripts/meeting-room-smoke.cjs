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
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const ownerCtx=await browser.newContext({permissions:['microphone','camera','clipboard-read','clipboard-write'],viewport:{width:1440,height:1000}});
 const guestCtx=await browser.newContext({permissions:['microphone','camera'],viewport:{width:390,height:844}});
 await ownerCtx.addInitScript(session=>localStorage.setItem('tescord.session',JSON.stringify(session)),account);
 const owner=await ownerCtx.newPage(),guest=await guestCtx.newPage();const errors=[];
 for(const p of [owner,guest])p.on('pageerror',e=>errors.push(e.message));
 try{
  await owner.goto(ui+'/my-room');await owner.getByRole('button',{name:'Начать / вернуться во встречу'}).click();
  await owner.getByRole('heading',{name:'Моя комната',exact:true}).waitFor();
  await owner.getByText('Пригласить участников · настройки встречи').click();
  const link=await owner.getByRole('textbox',{name:'Ссылка на встречу'}).inputValue();
  assert.ok(link.includes('/room/'));
  await guest.goto(link);await guest.getByRole('textbox',{name:'Ваше имя'}).fill('Гость без аккаунта');
  await guest.getByRole('button',{name:'Присоединиться',exact:true}).click();
  await guest.getByRole('button',{name:'Микрофон выкл.',exact:true}).waitFor();
  await guest.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Привет из гостевой комнаты');
  await guest.getByRole('button',{name:'Отправить',exact:true}).click();
  await owner.getByText('Привет из гостевой комнаты',{exact:true}).waitFor();
  await guest.locator('input[type=file]').setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('meeting file')});
  await guest.locator('.reply').filter({hasText:'note.txt'}).waitFor();await guest.getByRole('button',{name:'Отправить',exact:true}).click();
  await owner.getByRole('button',{name:'↓ note.txt'}).waitFor();
  await owner.getByRole('button',{name:'Ответить',exact:true}).first().click();
  await owner.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Ответ владельца');await owner.getByRole('button',{name:'Отправить',exact:true}).click();
  await guest.getByText('Ответ владельца',{exact:true}).waitFor();
  assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(media){
   await owner.getByText('На связи',{exact:true}).waitFor();await guest.getByText('На связи',{exact:true}).waitFor();
   await owner.getByRole('button',{name:'Микрофон выкл.',exact:true}).click();
   await guest.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>a.srcObject?.getAudioTracks().length));
   await owner.getByRole('button',{name:'Камера выкл.',exact:true}).click();
   await guest.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.videoWidth>0));
   await guest.getByRole('slider',{name:'Общая громкость',exact:true}).fill('40');
   await guest.waitForFunction(()=>[...document.querySelectorAll('audio')].every(a=>Math.abs(a.volume-.4)<.01));
   await guest.getByRole('slider',{name:/Громкость: room_/}).fill('50');
   await guest.waitForFunction(()=>[...document.querySelectorAll('audio')].every(a=>Math.abs(a.volume-.2)<.01));
  }
  await owner.screenshot({path:path.join(out,'room-desktop.png'),fullPage:true});await guest.screenshot({path:path.join(out,'room-mobile.png'),fullPage:true});
  await owner.getByRole('button',{name:'Выйти',exact:true}).click();await guest.getByText(/Владелец отключился/).waitFor();
  await owner.getByRole('button',{name:'Начать / вернуться во встречу'}).click();
  await guest.waitForFunction(()=>!document.querySelector('.owner-away'));
  owner.once('dialog',d=>d.accept());await owner.getByRole('button',{name:'Завершить для всех'}).click();
  await guest.getByText('Встреча завершена. Для следующей встречи нужна новая ссылка.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({guestChat:true,files:true,replies:true,ownerReturn:true,endForAll:true,mobileFits:true,media,errors}));
 }catch(error){await owner.screenshot({path:path.join(out,'room-owner-failure.png'),fullPage:true});await guest.screenshot({path:path.join(out,'room-guest-failure.png'),fullPage:true});console.error('Page errors:',errors);throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
