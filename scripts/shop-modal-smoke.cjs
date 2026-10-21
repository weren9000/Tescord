const {chromium}=require('../desktop/node_modules/playwright');
const sass=require('../frontend/node_modules/sass');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const css=sass.compile('frontend/src/app/workspace/inventory.component.scss',{logger:sass.Logger.silent}).css.replaceAll(':host','body');
 fs.mkdirSync('.local/shop-modals',{recursive:true});
 try{
  const page=await browser.newPage();
  for(const viewport of [{width:1440,height:900},{width:393,height:852},{width:852,height:393}]){
   await page.setViewportSize(viewport);
   await page.setContent(`<style>${css}body{--palette-surface:#101936;--palette-text:#eef;--palette-border:#445;--palette-raised:#202948;color:#eef}#store{width:90vw;height:70vh;overflow:hidden;background:#101936;color:#eef}.preview{height:320px;background:linear-gradient(30deg,#326,#157);border-radius:12px}*{box-sizing:border-box}</style>
    <dialog id="store"><header>Store <button id="origin">Open item</button></header><div class="inventory-backdrop embedded store-layout"><section class="inventory">
    <dialog appModalLayer class="panel-shade" id="detail"><section class="subpanel"><header><h3>Item details</h3><button id="close">Close</button></header><div class="panel-body"><div class="preview"></div><h3>Wallpaper</h3><button id="gift">Gift</button>${'<p>Item history entry</p>'.repeat(60)}</div></section></dialog>
    <dialog appModalLayer class="panel-shade confirmation" id="confirmation"><section class="confirm"><h3>Confirm gift</h3><button id="cancel">Cancel</button></section></dialog>
    </section></div></dialog>`);
   await page.evaluate(()=>{
    const store=document.querySelector('#store'),detail=document.querySelector('#detail'),confirmation=document.querySelector('#confirmation');
    store.showModal();document.querySelector('#origin').onclick=()=>detail.showModal();
    document.querySelector('#close').onclick=()=>detail.close();
    document.querySelector('#gift').onclick=()=>confirmation.showModal();
    document.querySelector('#cancel').onclick=()=>confirmation.close();
   });
   await page.click('#origin');
   const close=await page.locator('#close').boundingBox();assert(close.y>=0&&close.y+close.height<=viewport.height);
   await page.locator('.panel-body').evaluate(e=>e.scrollTop=e.scrollHeight);
   assert(await page.locator('.panel-body').evaluate(e=>e.scrollTop>0));
   assert(await page.locator('#close').isVisible());
   await page.locator('#gift').scrollIntoViewIfNeeded();await page.click('#gift');
   assert(await page.locator('#confirmation').evaluate(e=>e.matches(':modal')));
   await page.keyboard.press('Escape');assert(await page.locator('#detail').evaluate(e=>e.matches(':modal')));
   assert.equal(await page.evaluate(()=>document.activeElement.id),'gift');
   await page.locator('.panel-body').evaluate(e=>e.scrollTop=0);
   await page.screenshot({path:`.local/shop-modals/${viewport.width}.png`});
   await page.click('#close');assert(await page.locator('#store').evaluate(e=>e.open));
   assert.equal(await page.evaluate(()=>document.activeElement.id),'origin');
  }
  console.log('PASS: desktop, portrait, landscape; clipping, scroll, top-layer confirmation, Escape and focus restoration');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
