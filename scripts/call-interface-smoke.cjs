const {chromium}=require('../desktop/node_modules/playwright');
const sass=require('../frontend/node_modules/sass');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const css=['app.component','call-workspace','conference-stage'].map(n=>sass.compile(`frontend/src/app/${n}.scss`,{logger:sass.Logger.silent}).css).join('\n').replaceAll(':host','body');
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 fs.mkdirSync('.local/call-interface',{recursive:true});
 try{
 const page=await browser.newPage();
 for(const viewport of [{width:1440,height:900},{width:393,height:852},{width:320,height:568},{width:852,height:393},{width:393,height:420}]){
  await page.setViewportSize(viewport);
  await page.setContent(`<style>${css}body{margin:0;font:14px Arial;--palette-surface:#131c36;--palette-raised:#1b2744;--palette-canvas:#0c1325;--palette-text:#eee;--palette-muted:#bbc;--palette-cyan:#4edac5;--palette-border:#345;--palette-danger-surface:#652839;--palette-danger-text:#fcc;color:#eee}.demo-workspace{flex:1;min-height:0;display:flex;flex-direction:column;padding:12px;gap:12px;background:var(--palette-canvas)}.demo-messages{flex:1;min-height:0;overflow:auto}.demo-composer{height:52px;flex:none;background:var(--palette-raised)}button{color:inherit}app-ui-icon{display:inline-block}</style>
  <div class="messenger-shell messenger-shell--call-active"><section class="call-tray"><button class="call-tray__identity"><span class="call-tray__status call-tray__status--ready"></span><span class="call-tray__copy"><strong>Active room with a very long name</strong><small>Group · 30 participants</small></span><app-ui-icon>↗</app-ui-icon></button><div class="call-tray__controls"><button class="call-control-button">Mic</button><button class="call-control-button call-tray__leave">Exit</button></div></section><div class="demo-workspace"><div class="demo-messages">Conversation stays available</div><textarea class="demo-composer" aria-label="Message"></textarea></div></div>`);
  const bar=await page.locator('.call-tray').boundingBox(),composer=await page.locator('textarea').boundingBox();
  assert(bar.x>=0&&bar.x+bar.width<=viewport.width+1&&bar.y+bar.height<=composer.y);
  assert(composer.y+composer.height<=viewport.height+1);
  assert.equal(await page.locator('.call-tray__leave').isVisible(),viewport.width>980);
  assert((await page.locator('.call-tray__controls button').first().boundingBox()).width>=44);
  await page.screenshot({path:`.local/call-interface/tray-${viewport.width}-${viewport.height}.png`});
  for(const count of [1,2,10,30]){
   await page.locator('.demo-workspace').evaluate((e,count)=>{e.innerHTML=`<div class="conference-stage"><div class="conference-grid" style="--conference-columns:3">${Array.from({length:count},(_,i)=>`<div class="conference-tile"><span class="conference-initials">${i+1}</span><span class="conference-name">Participant ${i+1} with a long name</span></div>`).join('')}</div></div><div class="call-window__controls">${['Mic','Cam','Share','Users','More','Exit'].map(t=>`<button class="call-control-button">${t}</button>`).join('')}</div>`;},count);
   const controls=await page.locator('.call-window__controls').boundingBox();assert(controls.y+controls.height<=viewport.height+1);
   const grid=page.locator('.conference-grid');await grid.evaluate(e=>e.scrollTop=e.scrollHeight);
   if(count===30)await page.screenshot({path:`.local/call-interface/participants-${viewport.width}-${viewport.height}.png`});
  }
 }
 console.log('PASS: 5 viewport sizes, composer clearance, 44px controls, desktop/mobile exit visibility, 1/2/10/30 participant layouts');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
