// Use only with the disposable backend on 8007 and built frontend on 4207.
const {chromium}=require('../desktop/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const api='http://127.0.0.1:8007',ui='http://127.0.0.1:4207',out='.local/room-accounts';
async function json(path,token,body){const r=await fetch(api+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});assert(r.ok,await r.clone().text());return r.json();}
async function register(){const id=crypto.randomUUID().slice(0,8);return json('/api/auth/register',null,{email:'room_account_'+id+'@example.test',nick:'Account_'+id,password:'testpass123',password_confirmation:'testpass123'});}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const ownerAccount=await register(),memberAccount=await register();
 fs.writeFileSync(out+'/created-accounts.json',JSON.stringify([ownerAccount,memberAccount].map(a=>({id:a.user.id,email:a.user.email}))));
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'C:/Users/admin/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--mute-audio']});
 const errors=[];
 const context=async(account,width=1280)=>{const ctx=await browser.newContext({viewport:{width,height:900},permissions:['camera','microphone']});if(account)await ctx.addInitScript(a=>localStorage.setItem('tescord.session',JSON.stringify(a)),account);const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));return p;};
 const owner=await context(ownerAccount),member=await context({...memberAccount,user:{...memberAccount.user,nick:'Stale cached nickname'}}),guest=await context(null,393),expired=await context({...memberAccount,access_token:'expired'},393);
 try{
  await owner.goto(ui+'/my-room');await owner.getByRole('button',{name:'Начать / вернуться во встречу'}).click();
  await owner.getByRole('button',{name:'Пригласить по ссылке'}).click();const link=await owner.getByRole('textbox',{name:'Ссылка на встречу'}).inputValue();await owner.keyboard.press('Escape');
  await member.goto(link);await member.locator('.entry-profile strong').filter({hasText:memberAccount.user.nick}).waitFor();
  assert.equal(await member.getByRole('textbox',{name:'Ваше имя'}).count(),0);
  await member.locator('.entry-profile img').evaluate(img=>img.decode());
  await member.screenshot({path:out+'/registered-entry.png'});
  await member.getByRole('button',{name:'Присоединиться',exact:true}).click();await member.getByRole('button',{name:'Выйти из встречи'}).waitFor();
  const ticket=await member.evaluate(()=>JSON.parse(Object.entries(sessionStorage).find(([k,v])=>k.startsWith('kva.meeting.')&&v.includes('participant_id'))[1]));
  assert.equal(ticket.user_id,memberAccount.user.id);assert.equal(ticket.is_owner,false);
  await member.reload();await member.getByRole('button',{name:'Выйти из встречи'}).waitFor();
  const restored=await member.evaluate(()=>JSON.parse(Object.entries(sessionStorage).find(([k,v])=>k.startsWith('kva.meeting.')&&v.includes('participant_id'))[1]));assert.equal(restored.participant_id,ticket.participant_id);
  await guest.goto(link);await guest.getByRole('textbox',{name:'Ваше имя'}).fill(memberAccount.user.nick);await guest.getByRole('button',{name:'Присоединиться',exact:true}).click();
  await owner.getByRole('button',{name:'Участники',exact:true}).click();
  await owner.waitForFunction(id=>document.querySelectorAll('.participant-tile img[src*="'+id+'"]').length===1,memberAccount.user.id);
  assert.equal(await owner.locator('.person img[src*="'+memberAccount.user.id+'"]').count(),1);
  await owner.locator('.person').filter({hasText:'Гость'}).waitFor();
  await owner.screenshot({path:out+'/profiles-in-room.png'});
  await member.getByRole('button',{name:'Чат встречи',exact:true}).click();await member.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Message with account profile');await member.getByRole('button',{name:'Отправить',exact:true}).click();
  await guest.getByRole('button',{name:'Чат встречи',exact:true}).click();await guest.getByText('Message with account profile',{exact:true}).waitFor();
  const avatar=guest.locator('.message-avatar[src*="'+memberAccount.user.id+'"]');await avatar.waitFor();await avatar.evaluate(img=>img.decode());
  await expired.goto(link);await expired.getByRole('button',{name:'Продолжить гостем',exact:true}).waitFor();assert.equal(await expired.getByRole('textbox',{name:'Ваше имя'}).count(),0);
  await expired.getByRole('button',{name:'Продолжить гостем',exact:true}).click();await expired.getByRole('textbox',{name:'Ваше имя'}).waitFor();assert.equal(await expired.getByRole('textbox',{name:'Ваше имя'}).inputValue(),'');
  await expired.screenshot({path:out+'/explicit-guest.png'});
  await owner.getByRole('button',{name:'Выйти из встречи',exact:true}).click();await owner.getByRole('button',{name:'Завершить для всех',exact:true}).click();
  await guest.getByRole('heading',{name:'Встреча завершена',exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS: fresh account name, no name input, avatar in entry/stage/roster/chat, distinct guest, reload, explicit expired-session fallback');
 }catch(e){for(const [name,page] of Object.entries({owner,member,guest,expired}))await page.screenshot({path:out+'/'+name+'-failure.png'});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
