const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const fs=require('node:fs');
const testContext=require('./encryption-smoke-utils.cjs');
(async()=>{
 const data=testContext.fixture;
 const api=async(path,token,body,method='POST')=>{
   const r=await fetch(testContext.apiBase+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(!r.ok)throw Error('Local API '+path+' '+r.status);return r.json();
 };
 const sessions=await Promise.all(data.users.map(u=>api('/auth/login',null,{email:u.email,password:'local-test-only-password'})));
 const direct=await api('/conversations/direct',sessions[0].access_token,{user_id:data.users[1].id});
 const browser=await chromium.launch({headless:true});
 const pages=[];
 try {
  for(let i=0;i<2;i++){
   const context=await browser.newContext({viewport:{width:1440,height:1000}});
   context.setDefaultTimeout(12000);
   await context.addInitScript(s=>{if(!sessionStorage.getItem('test-seeded')){sessionStorage.setItem('test-seeded','1');localStorage.setItem('tescord.session',JSON.stringify(s));}},sessions[i]);
   const page=await context.newPage();pages.push(page);
   page.on('pageerror',e=>console.log('Page error: '+e.message.slice(0,200)));
   await page.goto(`${testContext.uiBase}/channels/${direct.id}/${direct.primary_channel_id}`);
  }
  await pages[0].waitForTimeout(3000);
  await pages[0].locator('.conversation-head__avatar').click();
  await pages[0].getByRole('button',{name:'Начать секретный чат',exact:true}).click();
  await pages[0].getByRole('button',{name:/^Браузер/}).last().click();
  await expect(pages[0].getByText('Ожидаем согласия собеседника.',{exact:true})).toBeVisible({timeout:15000});
  await pages[1].getByRole('button',{name:'Меню приложения',exact:true}).click();
  await pages[1].getByRole('button',{name:'Секретные чаты',exact:true}).click();
  await expect(pages[1].locator('app-secret-chats nav button').filter({hasText:'Crypto Alice'})).toBeVisible({timeout:15000});
  await pages[1].locator('app-secret-chats nav button').filter({hasText:'Crypto Alice'}).click();
  await pages[1].getByRole('button',{name:'Принять приглашение',exact:true}).click();
  await expect(pages[1].locator('app-secret-chats code')).toBeVisible();
  const codes=await Promise.all(pages.map(p=>p.locator('app-secret-chats code').innerText()));
  expect(codes[0]).toBe(codes[1]);
  for(const page of pages){
    await page.getByRole('checkbox',{name:'Мы сравнили коды, они совпадают'}).check();
    await page.getByRole('button',{name:'Подтвердить устройство',exact:true}).click();
    await expect(page.getByText('Устройство проверено · Сквозное шифрование',{exact:true})).toBeVisible();
  }
  await pages[0].getByLabel('Секретное сообщение',{exact:true}).fill('Private end-to-end message 123');
  await pages[0].getByRole('button',{name:'Отправить',exact:true}).click();
  await expect(pages[1].getByText('Private end-to-end message 123',{exact:true})).toBeVisible({timeout:20000});
  await pages[1].getByLabel('Секретное сообщение',{exact:true}).fill('Reply from second device');
  await pages[1].getByRole('button',{name:'Отправить',exact:true}).click();
  await expect(pages[0].getByText('Reply from second device',{exact:true})).toBeVisible({timeout:20000});
  const original=pages[0].locator('app-secret-chats article').filter({hasText:'Private end-to-end message 123'});
  await original.getByRole('button',{name:'Изменить',exact:true}).click();
  await pages[0].getByLabel('Секретное сообщение',{exact:true}).fill('Edited secret text');
  await pages[0].getByRole('button',{name:'Отправить',exact:true}).click();
  await expect(pages[1].getByText('Edited secret text',{exact:true})).toBeVisible({timeout:20000});
  const bytes=Buffer.alloc(2*1024*1024+123, 137);
  bytes.write('Private filename and bytes must be encrypted');
  await pages[0].locator('app-secret-chats input[type=file]').setInputFiles({name:'private-document.bin',mimeType:'application/octet-stream',buffer:bytes});
  await expect(pages[1].getByText('private-document.bin',{exact:true})).toBeVisible({timeout:25000});
  // Use the bounded download fallback so the test does not automate a native file chooser.
  await pages[1].evaluate(()=>{window.showSaveFilePicker=undefined;});
  const downloaded=pages[1].waitForEvent('download');
  await pages[1].getByRole('button',{name:'Скачать файл',exact:true}).click();
  const download=await downloaded; const saved=await download.path();
  expect(fs.readFileSync(saved)).toEqual(bytes);
  const ownReply=pages[1].locator('app-secret-chats article').filter({hasText:'Reply from second device'});
  await ownReply.getByRole('button',{name:'Удалить',exact:true}).click();
  await expect(pages[0].getByText('Reply from second device',{exact:true})).toHaveCount(0,{timeout:20000});
  await pages[0].screenshot({path:'.local/secret-chat-desktop.png'});
  await pages[0].reload();
  await pages[0].getByRole('button',{name:'Меню приложения',exact:true}).click();
  await pages[0].getByRole('button',{name:'Секретные чаты',exact:true}).click();
  await pages[0].locator('app-secret-chats nav button').filter({hasText:'Crypto Bob'}).last().click();
  await expect(pages[0].getByText('Edited secret text',{exact:true})).toBeVisible({timeout:15000});
  for(const width of [320,393,1024]){
    await pages[0].setViewportSize({width,height:850});
    const dimensions=await pages[0].locator('app-secret-chats dialog').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,overflow:[...e.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right>e.getBoundingClientRect().right).map(x=>({tag:x.tagName,cls:x.className}))}));
    if(dimensions.scroll>dimensions.width) console.log(JSON.stringify(dimensions));
    expect(dimensions.scroll<=dimensions.width).toBe(true);
    await pages[0].screenshot({path:'.local/secret-chat-'+width+'.png'});
    if(width===320){await pages[0].evaluate(()=>{const palette={canvas:'#f5f6fa',surface:'#ffffff',raised:'#eef0f6',text:'#161925',muted:'#50596d',secondary:'#50596d',subtle:'#657088',border:'#c2c8d6',selected:'#eee8ff',hover:'#e6e7f0','primary-text':'#5935c9'};for(const [k,v] of Object.entries(palette))document.documentElement.style.setProperty('--palette-'+k,v);});await pages[0].screenshot({path:'.local/secret-chat-light-320.png'});await pages[0].evaluate(()=>document.documentElement.removeAttribute('style'));}
  }
  // Reauthentication must prove possession of the existing device key and
  // preserve the locally encrypted history. Account login alone is insufficient.
  const renewed=await api('/auth/login',null,{email:data.users[0].email,password:'local-test-only-password'});
  await pages[0].evaluate(s=>localStorage.setItem('tescord.session',JSON.stringify(s)),renewed);
  await pages[0].reload();
  await pages[0].getByRole('button',{name:'Меню приложения',exact:true}).click();
  await pages[0].getByRole('button',{name:'Секретные чаты',exact:true}).click();
  await pages[0].locator('app-secret-chats nav button').filter({hasText:'Crypto Bob'}).last().click();
  await expect(pages[0].getByText('Edited secret text',{exact:true})).toBeVisible({timeout:15000});
  let failDelivery=true;
  await pages[0].route('**/api/secret/chats/*/envelopes',async route=>{
    if(route.request().method()==='POST'&&route.request().postDataJSON()?.kind==='message'&&failDelivery){failDelivery=false;return route.fulfill({status:503,json:{detail:'Synthetic interrupted delivery'}});}
    return route.continue();
  });
  await pages[0].getByLabel('Секретное сообщение',{exact:true}).fill('Queued ciphertext survives reload');
  await pages[0].getByRole('button',{name:'Отправить',exact:true}).click();
  await expect(pages[0].getByLabel('Секретное сообщение',{exact:true})).toHaveValue('');
  await pages[0].reload();
  await pages[0].getByRole('button',{name:'Меню приложения',exact:true}).click();
  await pages[0].getByRole('button',{name:'Секретные чаты',exact:true}).click();
  await pages[0].locator('app-secret-chats nav button').filter({hasText:'Crypto Bob'}).last().click();
  await expect(pages[1].getByText('Queued ciphertext survives reload',{exact:true})).toHaveCount(1,{timeout:20000});
  await pages[0].getByLabel('Секретное сообщение',{exact:true}).fill('Unsent draft stays here');
  await pages[0].getByRole('button',{name:'Закрыть секретные чаты',exact:true}).click();
  await pages[0].getByRole('button',{name:'Меню приложения',exact:true}).click();
  await pages[0].getByRole('button',{name:'Секретные чаты',exact:true}).click();
  await expect(pages[0].getByLabel('Секретное сообщение',{exact:true})).toHaveValue('Unsent draft stays here');
  pages[0].on('dialog',d=>d.accept());
  await pages[0].getByRole('button',{name:'Завершить чат',exact:true}).click();
  await expect(pages[1].getByText('Чат завершён. Прочитанная история остаётся на этом устройстве.',{exact:true})).toBeVisible({timeout:15000});
  await pages[1].getByRole('button',{name:'Закрыть секретные чаты',exact:true}).click();
  await pages[1].getByRole('button',{name:'Меню приложения',exact:true}).click();
  pages[1].on('dialog',d=>d.accept());
  await pages[1].getByRole('button',{name:'Выход',exact:true}).click();
  await expect(pages[1].getByText('Войти', {exact:true}).first()).toBeVisible({timeout:15000});
  const remains=await pages[1].evaluate(async user=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kvachat-secret-local-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return await Promise.all(['vaults','rooms','messages','outbox'].map(table=>new Promise(resolve=>{
      const r=db.transaction(table).objectStore(table).getAllKeys();r.onsuccess=()=>resolve(r.result.filter(k=>String(k).startsWith(user)).length);
    })));
  },sessions[1].user.id);
  expect(remains).toEqual([0,0,0,0]);
  console.log('Two clients: verified encryption, edit/delete, multi-chunk file, reload, drafts, 320/393/1024px, closure and logout erasure passed.');
 }catch(error){
  for(let i=0;i<pages.length;i++){
   console.log('Client '+i+': '+(await pages[i].locator('app-secret-chats').innerText().catch(()=>'')));
   await pages[i].screenshot({path:'.local/secret-e2e-failure-'+i+'.png'}).catch(()=>{});
  }
  throw error;
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
