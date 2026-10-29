const {chromium,expect}=require('../../../frontend/node_modules/@playwright/test');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch();
 try {
  for(const width of [1440,393,320]) {
   const context=await browser.newContext({viewport:{width,height:900}});
   const saved=new Map(); let failGet=false,failPut=false;
   await context.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path.startsWith('/plugins/')) return route.continue();
    if(path.startsWith('/api/applications')) {
     const key=req.headers().authorization;
     if((req.method()==='GET'&&failGet)||(req.method()==='PUT'&&failPut))return route.fulfill({status:503,body:'{}'});
     if(req.method()==='PUT')saved.set(key,req.postDataJSON().enabled);
     const item={id:'game-calendar',name:'Когда игра',description:'Календарь ролевых игр и конвентов.',enabled:saved.get(key)||false};
     return route.fulfill({json:req.method()==='GET'?[item]:item});
    }
    return route.fulfill({json:[]});
   });
   const page=await context.newPage();
   const login=async(token='fixture')=>{
    await page.goto('http://127.0.0.1:4217/login');
    await page.waitForFunction(()=>window.ng?.getComponent?.(document.querySelector('app-root')));
    await page.evaluate(token=>{const a=ng.getComponent(document.querySelector('app-root'));a.session.set({access_token:token});a.currentUser.set({id:token,nick:'Test',email:'test@example.test'});ng.applyChanges(a);},token);
   };
   const applications=async()=>{
    if(width<980)await page.getByRole('button',{name:'Меню приложения',exact:true}).filter({visible:true}).click();
    await page.getByRole('button',{name:'Приложения',exact:true}).filter({visible:true}).click();
   };
   const dialog=page.getByRole('dialog',{name:'Приложения',exact:true});
   const checkbox=page.getByRole('checkbox',{name:'Подключить Когда игра'});
   await login();await applications();
   await page.getByRole('button',{name:'Выбрать приложения'}).click();
   await expect(checkbox).not.toBeChecked();
   await page.screenshot({path:`artifacts/game-calendar/applications-catalog-${width}.png`});
   failPut=true;await checkbox.click();
   await expect(page.getByRole('alert')).toContainText('Не удалось сохранить');
   await expect(checkbox).not.toBeChecked();
   failPut=false;await checkbox.focus();await page.keyboard.press('Space');
   await expect(checkbox).toBeEnabled();await expect(checkbox).toBeChecked();
   await page.getByRole('button',{name:'Мои приложения',exact:true}).click();
   await expect(page.getByRole('button',{name:'Открыть Когда игра'})).toBeVisible();
   await page.screenshot({path:`artifacts/game-calendar/applications-mine-${width}.png`});
   assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const opened=context.waitForEvent('page');await page.getByRole('button',{name:'Открыть Когда игра'}).click();
   const plugin=await opened;await plugin.waitForLoadState();
   assert.equal(new URL(plugin.url()).pathname,'/plugins/game-calendar/');await plugin.close();
   await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
   await expect(page.getByRole('button',{name:width<980?'Меню приложения':'Приложения',exact:true}).filter({visible:true})).toBeFocused();
   await expect(page.getByRole('button',{name:'Когда игра',exact:true})).toHaveCount(0);
   await login();await applications();
   await expect(page.getByRole('button',{name:'Открыть Когда игра'})).toBeVisible();
   await page.keyboard.press('Escape');
   failGet=true;await applications();await expect(page.getByRole('alert')).toContainText('Не удалось загрузить');
   failGet=false;await page.getByRole('button',{name:'Повторить',exact:true}).click();
   await expect(page.getByRole('button',{name:'Открыть Когда игра'})).toBeVisible();
   await page.getByRole('button',{name:'Каталог',exact:true}).click();await checkbox.uncheck();await expect(checkbox).toBeEnabled();
   await page.getByRole('button',{name:'Мои приложения',exact:true}).click();await expect(page.getByText('Пока нет приложений')).toBeVisible();
   await page.keyboard.press('Escape');
   saved.set('Bearer fixture',true);await login('another-account');await applications();
   await expect(page.getByText('Пока нет приложений')).toBeVisible();
   await context.close();
  }
  console.log('PASS: catalog, connection, persistence, isolation, errors/retry, launch, Escape/focus and widths 1440/393/320');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
