const { chromium, expect } = require('../../../frontend/node_modules/@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = 'http://127.0.0.1:8012/plugins/game-calendar/';
const output = 'artifacts/game-calendar';
fs.mkdirSync(output, { recursive: true });
const stamp = new Date(); stamp.setUTCDate(stamp.getUTCDate() + 10);
const start = stamp.toISOString().slice(0, 10); stamp.setUTCDate(stamp.getUTCDate() + 2);
const end = stamp.toISOString().slice(0, 10);
const event = {id: 1, name: 'Лес, легенды; новая глава', region: 'Урал', type: 'Полевая', status: 'Заявлена',
  start_date: start, end_date: end, venue: 'Лесной полигон', organizer: 'Мастера', players: 100,
  description: '<img src=x onerror=alert(1)>', website: 'https://example.test', source_url: 'https://kogda-igra.ru/game/1/'};
(async () => {
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let mode='normal';
  await page.route('**/api/events',route=>{
   if(mode==='error')return route.fulfill({status:503,body:'{}'});
   const data={ready:mode!=='empty',stale:mode==='stale',last_attempt_failed:mode==='stale',updated_at:new Date().toISOString(),events:mode==='empty'?[]:[event,{...event,id:2,name:'Конвент другого города',region:'Москва',type:'Конвент',status:'Отменена'}, {...event,id:3,name:'Очень длинное название игры '.repeat(8),region:'Урал',start_date:null,end_date:null}]};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(base);await expect(page.locator('.event')).toHaveCount(3);
  await page.locator('#region').selectOption('Москва');await expect(page.locator('.event')).toHaveCount(1);
  await page.locator('#reset').click();await page.locator('#search').fill('легенды мастера');await expect(page.locator('.event')).toHaveCount(1);
  await page.locator('.event .icon-button').click();await page.reload();await page.locator('[data-view=saved]').click();await expect(page.locator('.event')).toHaveCount(1);
  await page.locator('.event-title').click();await expect(page.locator('#detail')).toBeVisible();
  await expect(page.locator('#detail-description img')).toHaveCount(0);
  const download=page.waitForEvent('download');await page.locator('#export').click();const file=await download;
  const content=fs.readFileSync(await file.path(),'utf8');
  assert(content.includes('SUMMARY:Лес\\, легенды\\; новая глава'));
  const exclusive=new Date(end+'T12:00:00Z');exclusive.setUTCDate(exclusive.getUTCDate()+1);
  assert(content.includes('DTEND;VALUE=DATE:'+exclusive.toISOString().slice(0,10).replaceAll('-','')));
  await page.keyboard.press('Escape');await expect(page.locator('#detail')).not.toBeVisible();
  await page.locator('[data-view=upcoming]').click();
  await expect(page.locator('#reset')).toBeHidden();
  for(const width of [1440,768,390,320]){
   await page.setViewportSize({width,height:900});await page.screenshot({path:`${output}/fixture-${width}.png`,fullPage:true});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);
   await page.locator('.event-title').first().click();await page.screenshot({path:`${output}/detail-${width}.png`});
   assert(await page.locator('#detail').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.keyboard.press('Escape');
  }
  await expect(page.locator('#filter-options')).toBeHidden();
  await page.locator('#toggle-filters').click();
  await expect(page.locator('#toggle-filters')).toHaveAttribute('aria-expanded','true');
  await expect(page.getByLabel('Регион',{exact:true})).toBeVisible();
  await page.locator('#region').selectOption('Москва');
  await expect(page.locator('#toggle-filters')).toHaveText('Фильтры · 1');
  await expect(page.locator('#reset')).toBeVisible();
  await page.locator('#toggle-filters').click();
  await expect(page.locator('#filter-options')).toBeHidden();
  await expect(page.locator('.event')).toHaveCount(1);
  await page.setViewportSize({width:1440,height:900});
  await expect(page.locator('#filter-options')).toBeVisible();
  await expect(page.locator('#region')).toHaveValue('Москва');
  await page.setViewportSize({width:320,height:900});
  await expect(page.locator('#filter-options')).toBeHidden();
  await page.locator('#reset').click();
  await expect(page.locator('#reset')).toBeHidden();
  await expect(page.locator('#search')).toBeFocused();
  await expect(page.locator('.event')).toHaveCount(3);
  await page.locator('[data-view=saved]').click();
  await page.locator('#search').fill('несуществующая игра');
  await page.locator('#reset').click();
  await expect(page.locator('[data-view=saved]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.event')).toHaveCount(1);
  await page.locator('[data-view=upcoming]').click();
  mode='stale';await page.reload();await expect(page.locator('#notice')).toBeVisible();await expect(page.locator('.event')).toHaveCount(3);
  mode='error';await page.reload();await expect(page.locator('#error')).toBeVisible();mode='normal';await page.locator('#retry').click();await expect(page.locator('.event')).toHaveCount(3);
  mode='empty';await page.reload();await expect(page.locator('#empty-title')).toHaveText('Календарь готовится');
  assert.deepEqual(errors,[]);
  await page.unroute('**/api/events');await page.goto(base);await page.locator('#loading').waitFor({state:'hidden'});
  for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:`${output}/live-${width}.png`,fullPage:true});}
  console.log('PASS: filters, search, favorites persist, safe text, calendar export, Escape, responsive layouts, stale/error/retry/empty states');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
