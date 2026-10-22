const {chromium,request}=require('../desktop/node_modules/playwright');
const assert=require('node:assert/strict');
// Run against the isolated local API (8000) and Angular dev server (4210).
// Creates disposable users; never point this regression at production.
(async()=>{
 const api=await request.newContext({baseURL:'http://127.0.0.1:8000'});
 const call=async(method,path,token,data)=>{const r=await api.fetch('/api'+path,{method,headers:token?{Authorization:'Bearer '+token}:{},data});assert(r.ok(),path+' '+await r.text());return r.status()===204?null:r.json();};
 const stamp=Date.now();const accounts=[];
 for(let i=0;i<3;i++)accounts.push(await call('POST','/auth/register',null,{email:`refresh-${stamp}-${i}@example.test`,nick:`Refresh ${stamp} ${i}`,password:'testpass123',password_confirmation:'testpass123'}));
 const [owner,guest]=accounts;
 const platform=await call('POST','/platforms',owner.access_token,{name:'Invitation target'});
 const invite=await call('POST',`/platforms/${platform.id}/invites`,owner.access_token,{});
 await call('POST','/conversations/group',guest.access_token,{name:'Existing group',member_user_ids:[]});
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext();await context.addInitScript(s=>localStorage.setItem('tescord.session',JSON.stringify(s)),guest);await context.routeWebSocket('**/*',ws=>ws.close());const page=await context.newPage();
  await page.goto('http://127.0.0.1:4210/platform-invite/'+invite.token);
  await page.locator('.invite-preview').waitFor();
  await page.evaluate(async()=>{const a=window.ng.getComponent(document.querySelector('app-root'));await a.resyncAfterAppEventsReconnect();});
  await page.waitForTimeout(500);
  console.log(await page.evaluate(()=>({mode:window.ng.getComponent(document.querySelector('app-root')).workspaceMode(),preview:!!document.querySelector('.invite-preview')})));
  assert(await page.locator('.invite-preview').isVisible(),'Invitation disappeared during realtime refresh');
  await page.locator('dialog button.primary').click();
  await page.waitForFunction(id=>window.ng.getComponent(document.querySelector('app-root')).selectedPlatformId()===id,platform.id);
  assert((await call('GET','/platforms',guest.access_token)).some(p=>p.id===platform.id));
  assert.equal(await page.evaluate(()=>window.ng.getComponent(document.querySelector('app-root')).platformInviteOpen()),false);
  console.log('PASS existing-group user: invitation survives realtime refresh and joins');
  const unauth=accounts[2];
  await call('POST','/conversations/group',unauth.access_token,{name:'Another existing group',member_user_ids:[]});
  const fresh=await browser.newContext();await fresh.routeWebSocket('**/*',ws=>ws.close());
  const login=await fresh.newPage();
  await login.goto('http://127.0.0.1:4210/platform-invite/'+invite.token);
  await login.getByLabel('Email',{exact:true}).fill(unauth.user.email);
  await login.locator('input[type=password]').fill('testpass123');
  await login.locator('button[type=submit]').click();
  await login.locator('.invite-preview').waitFor();
  await login.evaluate(()=>window.ng.getComponent(document.querySelector('app-root')).resyncAfterAppEventsReconnect());
  await login.waitForTimeout(500);
  assert(await login.locator('.invite-preview').isVisible());
  await login.keyboard.press('Escape');
  await login.waitForFunction(()=>!window.ng.getComponent(document.querySelector('app-root')).platformInviteOpen());
  await login.evaluate(()=>window.ng.getComponent(document.querySelector('app-root')).resyncAfterAppEventsReconnect());
  await login.waitForFunction(()=>window.ng.getComponent(document.querySelector('app-root')).workspaceMode()==='groups');
  await login.goto('http://127.0.0.1:4210/platform-invite/'+invite.token);
  await login.locator('.invite-preview').waitFor();
  await login.locator('dialog button.primary').click();
  await login.waitForFunction(id=>window.ng.getComponent(document.querySelector('app-root')).selectedPlatformId()===id,platform.id);
  assert((await call('GET','/platforms',unauth.access_token)).some(p=>p.id===platform.id));
  console.log('PASS login preserves invitation; cancel restores fallback; reopening joins');
 }finally{await browser.close();await api.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1});
