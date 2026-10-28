const {chromium,expect}=require('../../../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch();
 try{
  for(const width of [1440,320]){
   const context=await browser.newContext({viewport:{width,height:900}});
   await context.route('**/api/**',route=>{
    if(new URL(route.request().url()).pathname.startsWith('/plugins/'))return route.continue();
    return route.fulfill({contentType:'application/json',body:'[]'});
   });
   const page=await context.newPage();await page.goto('http://127.0.0.1:4217/login');
   await page.waitForFunction(()=>window.ng?.getComponent?.(document.querySelector('app-root')));
   await page.evaluate(()=>{const a=ng.getComponent(document.querySelector('app-root'));a.session.set({access_token:'fixture'});a.currentUser.set({id:'self',nick:'Test',email:'test@example.test'});ng.applyChanges(a);});
   if(width<980)await page.getByRole('button',{name:'Меню приложения',exact:true}).click();
   const opened=context.waitForEvent('page');
   await page.getByRole('button',{name:'Календарь игр',exact:true}).filter({visible:true}).click();
   const plugin=await opened;await plugin.waitForLoadState();
   assert.equal(new URL(plugin.url()).pathname,'/plugins/game-calendar/');
   await expect(plugin.locator('h1')).toHaveText('Календарь игр.');
   await expect(plugin.locator('#loading')).toBeHidden();
   await expect(plugin.locator('#error')).toBeHidden();
   await page.screenshot({path:`artifacts/game-calendar/host-${width}.png`});
   await plugin.screenshot({path:`artifacts/game-calendar/opened-${width}.png`});
   await context.close();
  }
  console.log('PASS: desktop navigation and mobile menu open independent plugin through host proxy');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
