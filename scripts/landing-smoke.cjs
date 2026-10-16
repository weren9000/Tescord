const {chromium}=require('../desktop/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),base='http://localhost:4200';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.KVA_CHROME||'C:/Users/admin/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',headless:true,args:['--disable-features=LocalNetworkAccessChecks']});
 const output=path.resolve(root,'../landing-review');fs.mkdirSync(output,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('app-landing').waitFor();
  await page.locator('.landing-preview img').evaluate(img=>img.decode());
  assert.equal(await page.locator('.landing-download').count(),2);
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  for(const width of [320,393,768,1024]){
   await page.setViewportSize({width,height:900});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);
   if(width===393)await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  }
  await page.locator('.landing-help summary').click();assert(await page.locator('.checksum-links').isVisible());
  await page.locator('.landing-open').click();await page.getByLabel('Email',{exact:true}).waitFor();assert.equal(await page.locator('app-landing').count(),0);
  await page.goBack();await page.locator('app-landing').waitFor();
  const android=await browser.newPage({viewport:{width:393,height:851},userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'});
  await android.goto(base);await android.locator('app-landing').waitFor();
  const androidX=await android.locator('.android-download').evaluate(el=>el.getBoundingClientRect().left),windowsX=await android.locator('.windows-download').evaluate(el=>el.getBoundingClientRect().left);assert(androidX<windowsX);
  const native=await browser.newPage();await native.addInitScript(()=>{window.kvaDesktop={version:'test',readSession:()=>null,writeSession:()=>true};});await native.goto(base);await native.getByLabel('Email',{exact:true}).waitFor();assert.equal(await native.locator('app-landing').count(),0);
  await page.goto(base+'/?friend=10001');await page.getByLabel('Email',{exact:true}).waitFor();assert.equal(await page.locator('app-landing').count(),0);
  await page.goto(base+'/invite/landing-invalid');await page.getByLabel('Email',{exact:true}).waitFor();assert.equal(await page.locator('app-landing').count(),0);
  if(process.env.KVA_TEST_FIXTURE){
   const fixture=JSON.parse(fs.readFileSync(process.env.KVA_TEST_FIXTURE,'utf8'));
   await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill(fixture.users[0].form.email);await page.getByLabel('Пароль',{exact:true}).fill(fixture.users[0].form.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.locator('app-section-navigation').waitFor();await page.goto(base);await page.locator('app-section-navigation').waitFor();assert.equal(await page.locator('app-landing').count(),0);
  }
  const staticPage=await browser.newPage({javaScriptEnabled:false});await staticPage.goto(base);assert.equal(await staticPage.locator('h1').count(),1);assert.equal(await staticPage.locator('.landing-download').count(),2);
  for(const filename of ['KvaChat-Setup-0.5.0-x64.exe','KvaChat-0.3.0-android.apk']){
   const response=await page.request.get(base+'/downloads/'+filename);assert(response.ok());const bytes=await response.body();
   const checksum=fs.readFileSync(path.join(root,'frontend/public/downloads',filename+'.sha256'),'utf8').split(/\s/)[0];assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),checksum);
  }
  assert.deepEqual(errors,[]);console.log('PASS: desktop/mobile, Android ordering, login/back, native bypass, friend invite, no-JS HTML, both download hashes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
