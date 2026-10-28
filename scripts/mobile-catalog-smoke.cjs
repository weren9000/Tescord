const { chromium, expect } = require('../frontend/node_modules/@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
 const browser = await chromium.launch();
 fs.mkdirSync('.local/mobile-catalog', { recursive: true });
 try {
 for (const width of [320,360,393,430,1440]) {
  const page = await browser.newPage({viewport:{width,height:820}});
  const errors=[],requests=[];
  const rows=Array.from({length:14},(_,i)=>({id:'item-'+i,catalog_id:'catalog-'+i,name:['Серебряная филигрань','Северное сияние','Лунная эльфийка','Лесная тема'][i%4],kind:['frame','wallpaper','avatar','theme'][i%4],price:100+i*25,rarity:'rare',equipped:i===0,in_use:i===0,owned:1,status:'published',created_at:'2026-10-28T10:00:00Z',owner:{id:'self',nick:'Тестер'}}));
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>{
   const u=new URL(r.request().url()),p=u.pathname;requests.push(u);
   if (/assets|image|preview|avatar-presets/.test(p)) return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" rx="25" fill="#393060"/><circle cx="80" cy="80" r="50" fill="none" stroke="#ac8aff" stroke-width="8"/><path d="M40 110L70 65L90 90L110 50L140 110" fill="#7764bb"/></svg>'});
   const data=p.endsWith('/history')?[]:p.includes('/inventory')||p==='/api/shop'||p.includes('/shop/admin/offers')?{items:rows,total:rows.length,page:1,pages:1,categories:{frame:4,wallpaper:4,avatar:3,theme:3},notifications:[],unread:1,equipped_ids:['item-0']}:p.includes('/wallet')?{coins:0,crystals:680}:[];
   return r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:4217/login');
  await page.waitForFunction(()=>window.ng?.getComponent?.(document.querySelector('app-root')));
  await page.evaluate(()=>{window.a=ng.getComponent(document.querySelector('app-root'));a.session.set({access_token:'fixture'});a.currentUser.set({id:'self',nick:'Тестер',email:'fixture@example.test'});a.shopInitialMode.set('inventory');a.shopOpen.set(true);ng.applyChanges(a);});
  const shop=page.locator('app-shop'),inv=shop.locator('app-inventory');
  await expect(inv.locator('.tile')).toHaveCount(14);
  await expect(inv.locator('.tile app-asset-preview img.ready').first()).toBeVisible();
  await page.screenshot({path:`.local/mobile-catalog/inventory-${width}.png`});
  if(width<981){
   await expect(inv.locator('.inventory-segments')).toBeHidden();
   assert((await inv.locator('.inventory-toolbar').boundingBox()).height<=50);
   const cards=await inv.locator('.tile').evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width})));
   assert(cards[0].y===cards[1].y&&cards[2].y>cards[0].y);
   await inv.locator('.mobile-item-caption').first().click();
   await expect(inv.getByRole('button',{name:'Назад в инвентарь',exact:true})).toBeVisible();
   await inv.getByRole('button',{name:'Назад в инвентарь',exact:true}).click();
   await inv.getByRole('button',{name:'Фильтры',exact:true}).click();
   const sheet=inv.locator('.inventory-filters');
   await sheet.getByLabel('Статус использования').selectOption('used');
   await sheet.getByLabel('Сортировка',{exact:true}).selectOption('name');
   await page.screenshot({path:`.local/mobile-catalog/inventory-filters-${width}.png`});
   await sheet.getByRole('button',{name:'Показать',exact:true}).click();
   await expect(inv.locator('.filter-count')).toHaveText('2');
   await expect.poll(()=>requests.some(u=>u.searchParams.get('usage')==='used'&&u.searchParams.get('sort')==='name')).toBeTruthy();
   await inv.getByRole('button',{name:'Фильтры',exact:true}).click();
   await sheet.getByRole('button',{name:'Сбросить',exact:true}).click();
   await sheet.getByRole('button',{name:'Показать',exact:true}).click();
   await expect(inv.locator('.filter-count')).toHaveCount(0);
   await inv.getByRole('textbox',{name:'Поиск по инвентарю'}).fill('Луна');
   await expect.poll(()=>requests.some(u=>u.pathname==='/api/inventory'&&u.searchParams.get('q')==='Луна')).toBeTruthy();
   await inv.getByRole('textbox',{name:'Поиск по инвентарю'}).fill('');
  }else{await expect(inv.locator('.inventory-segments')).toBeVisible();await expect(inv.locator('.card-caption').first()).toBeVisible();}
  await shop.getByRole('button',{name:'Витрина',exact:true}).click();
  await expect(shop.locator('app-store-product-card')).toHaveCount(14);
  await expect(shop.locator('app-store-product-card app-asset-preview img.ready').first()).toBeVisible();
  await page.screenshot({path:`.local/mobile-catalog/store-${width}.png`});
  if(width<981){
   assert((await shop.locator('.catalog-toolbar').boundingBox()).height<=64);
   await shop.locator('app-store-product-card').nth(8).scrollIntoViewIfNeeded();
   const scrollBefore=await shop.locator('.content').evaluate(e=>e.scrollTop);
   await shop.locator('app-store-product-card .card').nth(8).click();
   await expect(shop.locator('.detail')).toBeVisible();
   await shop.locator('.back').click();
   await expect.poll(()=>shop.locator('.content').evaluate(e=>e.scrollTop)).toBe(scrollBefore);
   await shop.locator('.content').evaluate(e=>e.scrollTop=0);
   await expect(shop.locator('.catalog-toolbar select')).toBeHidden();
   await shop.getByRole('button',{name:'Фильтры',exact:true}).click();
   const sheet=shop.locator('.filter-sheet');
   await sheet.getByLabel('Избранное',{exact:true}).check();
   await sheet.getByLabel('Сортировка',{exact:true}).selectOption('cheap');
   await expect(sheet.getByRole('button',{name:/Показать/})).toBeEnabled();
   await page.screenshot({path:`.local/mobile-catalog/store-filters-${width}.png`});
   await sheet.getByRole('button',{name:/Показать/}).click();
   await expect(shop.locator('.filter-count')).toHaveText('2');
   await page.evaluate(()=>{window.s=ng.getComponent(document.querySelector('app-shop'));s.manage=()=>true;ng.applyChanges(s);});
   await shop.locator('.mobile-store-menu summary').click();
   await page.screenshot({path:`.local/mobile-catalog/management-${width}.png`});
   await shop.locator('.mobile-store-menu').getByRole('button',{name:'Товары и цены',exact:true}).click();
   await expect(shop.locator('.manager-tools')).toBeHidden();
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: mobile two-column cards, compact toolbar, details, filter apply/reset/query, management menu and desktop controls');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
