// Browser-side Android integration. Does not replace a physical Android test.
const {chromium}=require('../desktop/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.KVA_CHROME||'C:/Users/admin/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:393,height:851}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      let session=null;
      window.KvaNative={readSession:()=>session,writeSession:v=>{session=v;return true;},pendingTarget:()=>'',pendingCall:()=>null,clear:()=>{},media:()=>{},
        startScreen:()=>{window.dispatchEvent(new CustomEvent('kva-screen-started'));setTimeout(()=>window.dispatchEvent(new CustomEvent('kva-screen-error',{detail:'cancelled'})),10);},stopScreen:()=>{}};
    });
    await page.route('https://localhost/**',async route=>{
      let file=decodeURIComponent(new URL(route.request().url()).pathname);
      if(file==='/')file='/index.html';
      const root=path.resolve(__dirname,'web'),full=path.resolve(root,'.'+file);
      if(!full.startsWith(root+path.sep)||!fs.existsSync(full))return route.fulfill({status:404,body:''});
      await route.fulfill({path:full,contentType:({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'})[path.extname(full)]});
    });
    await page.goto('https://localhost/');
    await page.getByLabel('Email',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.kvaDesktop.version),'android-' + require('./package.json').version);
    assert.equal(await page.evaluate(async()=>(await fetch('https://kvachat.ru/api/health')).status),200);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile horizontal overflow');
    const screen=await page.evaluate(async()=>{
      const outcomes=[];
      for(let i=0;i<2;i++)try{await navigator.mediaDevices.getDisplayMedia({video:true});}catch(e){outcomes.push(e.name);}
      return outcomes;
    });
    assert.deepEqual(screen,['NotAllowedError','NotAllowedError'],'Cancelling capture must allow retry');
    assert.deepEqual(errors,[]);
    fs.mkdirSync(path.join(__dirname,'release'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'release','android-login-preview.png')});
    console.log('PASS: bundled login UI, Android bridge, production CORS, mobile width, capture cancellation and retry');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
