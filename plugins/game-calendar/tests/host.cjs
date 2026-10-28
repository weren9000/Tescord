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
   const calendar = () => page.getByRole('button',{name:'Когда игра',exact:true}).filter({visible:true});
   const menu = () => page.getByRole('button',{name:'Меню приложения',exact:true}).filter({visible:true}).click();
   const applications = async () => { await menu(); await page.getByRole('button',{name:'Приложения',exact:true}).click(); };
   await expect(calendar()).toHaveCount(0);
   await applications();
   const checkbox = page.getByRole('checkbox',{name:'Активировать Когда игра'});
   await expect(checkbox).not.toBeChecked();
   await page.screenshot({path:`artifacts/game-calendar/applications-off-${width}.png`});
   await checkbox.focus(); await page.keyboard.press('Space');
   await expect(checkbox).toBeChecked();
   await page.screenshot({path:`artifacts/game-calendar/applications-on-${width}.png`});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.keyboard.press('Escape');
   await expect(page.getByRole('dialog',{name:'Приложения',exact:true})).toHaveCount(0);
   await expect(page.getByRole('button',{name:'Меню приложения',exact:true}).filter({visible:true})).toBeFocused();
   await page.reload();
   await page.waitForFunction(()=>window.ng?.getComponent?.(document.querySelector('app-root')));
   await page.evaluate(()=>{const a=ng.getComponent(document.querySelector('app-root'));a.session.set({access_token:'fixture'});a.currentUser.set({id:'self',nick:'Test',email:'test@example.test'});ng.applyChanges(a);});
   if(width<980)await menu();
   await expect(calendar()).toHaveCount(1);
   const opened=context.waitForEvent('page');
   await calendar().click();
   const plugin=await opened;await plugin.waitForLoadState();
   assert.equal(new URL(plugin.url()).pathname,'/plugins/game-calendar/');
   await expect(plugin.locator('h1')).toHaveText('Календарь игр.');
   await expect(plugin.locator('#loading')).toBeHidden();
   await expect(plugin.locator('#error')).toBeHidden();
   await page.screenshot({path:`artifacts/game-calendar/host-${width}.png`});
   await plugin.screenshot({path:`artifacts/game-calendar/opened-${width}.png`});
   await plugin.close();
   await applications();
   await checkbox.uncheck();
   await page.keyboard.press('Escape');
   if(width<980)await menu();
   await expect(calendar()).toHaveCount(0);
   if(width<980)await page.keyboard.press('Escape');
   await page.evaluate(()=>{const a=ng.getComponent(document.querySelector('app-root'));a.pluginPreferences.setCalendarEnabled('someone-else',true);ng.applyChanges(a);});
   if(width<980)await menu();
   await expect(calendar()).toHaveCount(0);
   await context.close();
  }
  console.log('PASS: default hidden, keyboard activation, saved after reload, desktop/mobile open, deactivation, account isolation');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
