const testContext=require('./encryption-smoke-utils.cjs');
const {_electron,chromium,expect}=require('../frontend/node_modules/@playwright/test');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),adb=path.join(root,'.tools/sdk/platform-tools/adb.exe');
async function proxy(page){
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
  const response=await fetch(testContext.apiBase+url.pathname+url.search,{method:req.method(),headers:{...req.headers(),host:'127.0.0.1:8027'},...(req.postDataBuffer()?{body:req.postDataBuffer()}:{})});
  await route.fulfill({status:response.status,headers:{'content-type':response.headers.get('content-type')||'application/json','access-control-allow-origin':'*'},body:Buffer.from(await response.arrayBuffer())});
 });
 await page.routeWebSocket('**/*',ws=>ws.close());
}
async function check(page,label){
 page.setDefaultTimeout(15000);await proxy(page);
 if(label==='android')await page.goto('https://localhost/login');
 const data=testContext.fixture;
 const id=crypto.randomUUID(), sample=JSON.stringify({synthetic:'local-vault-test-value'});
 expect(await page.evaluate(({id,sample})=>window.kvaDesktop.writeSecretVault(id,sample),{id,sample})).toBe(true);
 expect(await page.evaluate(id=>window.kvaDesktop.readSecretVault(id),id)).toBe(sample);
 expect(await page.evaluate(()=>window.kvaDesktop.writeSecretVault('../escape', 'bad'))).toBe(false);
 if(label==='android'){
  const prefs=execFileSync(adb,['shell','run-as','ru.kvachat.encryptioncheck','cat','shared_prefs/secure.xml'],{encoding:'utf8'});
  expect(prefs.includes('local-vault-test-value')).toBe(false);
 }
 await page.evaluate(id=>window.kvaDesktop.writeSecretVault(id,null),id);
 expect(await page.evaluate(id=>window.kvaDesktop.readSecretVault(id),id)).toBeFalsy();
 await page.getByLabel('Email',{exact:true}).fill(data.users[0].email);
 await page.getByLabel('Пароль',{exact:true}).fill('local-test-only-password');
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.getByRole('button',{name:'Меню приложения',exact:true}).click();
 await page.getByRole('button',{name:'Секретные чаты',exact:true}).click();
 await expect(page.getByRole('button',{name:'Мои устройства',exact:true})).toBeVisible({timeout:20000});
 expect(await page.evaluate(()=>!!window.kvaDesktop.readSecretVault(JSON.parse(window.kvaDesktop.readSession()).user.id))).toBe(true);
 await page.screenshot({path:path.join(testContext.output,'secret-'+label+'.png')});
 await page.getByRole('button',{name:'Закрыть секретные чаты',exact:true}).click();
 await page.getByRole('button',{name:'Меню приложения',exact:true}).click();
 page.on('dialog',d=>d.accept());
 await page.getByRole('button',{name:'Выход',exact:true}).click();
 await expect(page.getByRole('button',{name:'Войти',exact:true})).toBeVisible();
 expect(await page.evaluate(id=>window.kvaDesktop.readSecretVault(id),data.users[0].id)).toBeFalsy();
 console.log(label+': native encrypted vault read/write/delete, invalid ID rejection, real SDK key registration and logout passed.');
}
(async()=>{
 if(process.argv[2]==='windows'){
  const profile=fs.mkdtempSync(path.join(testContext.output,'secret-windows-'));
  const env={...process.env,KVA_DESKTOP_TEST:'1',KVA_DESKTOP_TEST_URL:'http://localhost:4200/login',KVA_DESKTOP_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:path.join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[path.join(root,'desktop')],env});
  try{
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));
   const page=await app.firstWindow();await check(page,'windows');
   const destination=path.join(profile,'synthetic-download.bin');
   await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},destination);
   const written=await page.evaluate(async()=>{
    const bridge=window.kvaDesktop,id=await bridge.beginSecretDownload('test.bin',1048583);
    const wrong=await bridge.writeSecretDownload(id,2,new Uint8Array(7));
    const first=await bridge.writeSecretDownload(id,0,new Uint8Array(1048576).fill(41));
    const last=await bridge.writeSecretDownload(id,1,new Uint8Array(7).fill(42));
    return {wrong,first,last,closed:await bridge.endSecretDownload(id,true)};
   });
   expect(written).toEqual({wrong:false,first:true,last:true,closed:true});
   const saved=fs.readFileSync(destination);expect(saved.length).toBe(1048583);expect(saved[0]).toBe(41);expect(saved.at(-1)).toBe(42);
   console.log('windows: bounded native download, ordering validation and atomic finish passed.');
  }finally{await app.close();}
 }else{
  const pid=execFileSync(adb,['shell','pidof','ru.kvachat.encryptioncheck'],{encoding:'utf8'}).trim();
  if(!/^\d+$/.test(pid))throw Error('Missing isolated Android app');
  execFileSync(adb,['forward','tcp:9229','localabstract:webview_devtools_remote_'+pid]);
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9229',{noDefaults:true});
  try{const page=browser.contexts()[0].pages()[0];await check(page,'android');}
  finally{await browser.close();execFileSync(adb,['forward','--remove','tcp:9229']);}
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
