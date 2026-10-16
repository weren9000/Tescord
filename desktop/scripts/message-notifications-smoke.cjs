// Local test accounts and local services only; never writes production data.
const {_electron: electron} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const fixture = JSON.parse(fs.readFileSync(process.env.KVA_TEST_FIXTURE, 'utf8'));
const apps = [];
(async () => {
  const pages = [];
  for (const user of fixture.users.slice(0, 2)) {
    const env = {...process.env, KVA_DESKTOP_TEST: '1', KVA_DESKTOP_TEST_URL: 'http://localhost:4200', KVA_DESKTOP_PROFILE: fs.mkdtempSync(path.join(os.tmpdir(), 'kva-conference-'))};
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({args: [path.resolve(__dirname, '..'), '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], env});
    apps.push(app);
    const page = await app.firstWindow();
    pages.push(page);
    await page.getByLabel('Email', {exact: true}).fill(user.form.email);
    await page.getByLabel('Пароль', {exact: true}).fill(user.form.password);
    await page.getByRole('button', {name: 'Войти', exact: true}).click();
    await page.locator('app-section-navigation').getByRole('button', {name: 'Группы', exact: true}).click();
    await page.locator('app-conversation-list').getByRole('button', {name: fixture.groups[0].title, exact: true}).click();
  }
  const [a,b]=pages;
  const assert=require('node:assert/strict');
  async function setting(enabled){
    await a.evaluate(async ({id,enabled})=>{
      const session=JSON.parse(window.kvaDesktop.readSession());
      const response=await fetch('http://127.0.0.1:8000/api/push/conversations/'+id+'/setting',{method:'PUT',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({push_enabled:enabled})});
      if(!response.ok)throw new Error('setting '+response.status);
    },{id:fixture.groups[0].id,enabled});
    await a.reload();await a.locator('.messenger-shell').waitFor();
    await a.waitForLoadState('networkidle');
  }
  await setting(true);
  await apps[0].evaluate(({Notification})=>{
    globalThis.notices=[];
    const original=Notification.prototype.show;
    Notification.prototype.show=function(){globalThis.notices.push(this);return original.call(this);};
  });
  await apps[0].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  async function send(text){await b.locator('.composer textarea').fill(text);await b.locator('.composer textarea').press('Enter');}
  await send('Desktop notification test '+Date.now());
  for(let i=0;i<50&&await apps[0].evaluate(()=>globalThis.notices.length)===0;i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(await apps[0].evaluate(()=>globalThis.notices.length),1);
  await apps[0].evaluate(()=>globalThis.notices[0].emit('click'));
  assert.equal(await apps[0].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  await a.locator('app-section-navigation').getByRole('button',{name:'Группы',exact:true}).click();
  await a.locator('app-conversation-list').getByRole('button',{name:fixture.groups[1].title,exact:true}).click();
  await a.waitForLoadState('networkidle');
  await apps[0].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  await send('Other chat notification test '+Date.now());
  for(let i=0;i<80&&await apps[0].evaluate(()=>globalThis.notices.length)<2;i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(await apps[0].evaluate(()=>globalThis.notices.length),2);
  await apps[0].evaluate(()=>globalThis.notices[1].emit('click'));
  await a.waitForFunction(title=>document.querySelector('.conversation-head')?.textContent.includes(title),fixture.groups[0].title);
  await setting(false);
  const count=await apps[0].evaluate(()=>globalThis.notices.length);
  await apps[0].evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  await send('Muted notification test '+Date.now());
  await new Promise(r=>setTimeout(r,2000));
  assert.equal(await apps[0].evaluate(()=>globalThis.notices.length),count);
  await b.evaluate(target=>{
    const session=JSON.parse(window.kvaDesktop.readSession());
    const socket=new WebSocket('ws://127.0.0.1:8000/api/calls/ws');
    window.notificationTestCall=socket;
    socket.onopen=()=>socket.send(JSON.stringify({type:'authenticate',token:session.access_token}));
    socket.onmessage=event=>{const data=JSON.parse(event.data);if(data.type==='ready')socket.send(JSON.stringify({type:'call_request',target_user_id:target}));};
  },fixture.users[0].user.id);
  for(let i=0;i<80&&await apps[0].evaluate(()=>globalThis.notices.length)===count;i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(await apps[0].evaluate(()=>globalThis.notices.length),count+1);
  await apps[0].evaluate(()=>globalThis.notices.at(-1).emit('click'));
  await a.getByRole('button',{name:'Ответить',exact:true}).waitFor();
  await a.getByRole('button',{name:'Отклонить звонок',exact:true}).click();
  await b.evaluate(()=>window.notificationTestCall.close());
  console.log('PASS: real messages in active and other chats -> native notifications; click opens correct chat; muted conversation stays silent');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{for(const app of apps)await app.close().catch(()=>{});});
