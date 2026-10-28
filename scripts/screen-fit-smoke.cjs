// Real application SCSS + a live synthetic MediaStream; no production connections.
const {chromium}=require('../desktop/node_modules/playwright');
const sass=require('../frontend/node_modules/sass');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const css=sass.compile('frontend/src/app/app.component.scss',{logger:sass.Logger.silent}).css;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage();
 fs.mkdirSync('.local/screen-fit',{recursive:true});
 let checks=0;
 try {
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}${css}</style>
   <div class="call-media-fullscreen"><header class="call-media-fullscreen__bar"><div class="call-media-fullscreen__title"><strong>Screen sharing</strong></div><button id="expand">Fullscreen</button></header>
   <main class="call-media-fullscreen__stage"><video class="call-media-fullscreen__video call-media-fullscreen__video--screen" autoplay muted playsinline></video></main>
   <footer class="call-media-fullscreen__controls"><button>Microphone</button><button>Screen</button><button>Leave</button></footer></div>`);
  await page.evaluate(()=>{
   document.querySelector('#expand').onclick=()=>document.querySelector('.call-media-fullscreen').requestFullscreen();
   window.setSource=async(w,h)=>{
    const v=document.querySelector('video');
    v.srcObject?.getTracks().forEach(t=>t.stop());
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const x=c.getContext('2d');x.fillStyle='#203050';x.fillRect(0,0,w,h);
    x.strokeStyle='#00ff80';x.lineWidth=20;x.strokeRect(10,10,w-20,h-20);
    x.fillStyle='white';x.font='48px sans-serif';
    [[30,65],[w-150,65],[30,h-30],[w-150,h-30]].forEach(([a,b],i)=>x.fillText(String(i+1),a,b));
    v.srcObject=c.captureStream(5);await v.play();
   };
  });
  for(const native of [false,true]){
   if(native){await page.evaluate(()=>document.querySelector('.call-media-fullscreen').classList.remove('call-media-fullscreen--controls-hidden'));await page.click('#expand');await page.waitForFunction(()=>!!document.fullscreenElement);}
   for(const viewport of [{width:1440,height:900},{width:393,height:852},{width:852,height:393}]){
    await page.setViewportSize(viewport);
    for(const [w,h] of [[1920,1080],[1920,1200],[3440,1440],[1080,1920]]){
     await page.evaluate(([w,h])=>window.setSource(w,h),[w,h]);
     for(const hidden of [false,true]){
      await page.evaluate(hidden=>document.querySelector('.call-media-fullscreen').classList.toggle('call-media-fullscreen--controls-hidden',hidden),hidden);
      const result=await page.evaluate(()=>{
       const v=document.querySelector('video'),s=v.parentElement;
       const r=v.getBoundingClientRect(),b=s.getBoundingClientRect();
       const scale=Math.min(r.width/v.videoWidth,r.height/v.videoHeight);
       const left=r.left+(r.width-v.videoWidth*scale)/2,top=r.top+(r.height-v.videoHeight*scale)/2;
       return {left,top,right:left+v.videoWidth*scale,bottom:top+v.videoHeight*scale,
        bounds:{left:Math.max(0,b.left),top:Math.max(0,b.top),right:Math.min(innerWidth,b.right),bottom:Math.min(innerHeight,b.bottom)},fit:getComputedStyle(v).objectFit};
      });
      const b=result.bounds;
      assert(result.fit==='contain'&&result.left>=b.left-1&&result.top>=b.top-1&&result.right<=b.right+1&&result.bottom<=b.bottom+1,JSON.stringify({native,viewport,w,h,hidden,result}));
      checks++;
     }
    }
    await page.screenshot({path:`.local/screen-fit/${native?'native':'overlay'}-${viewport.width}.png`});
   }
   if(native)await page.evaluate(()=>document.exitFullscreen());
  }
  console.log(`PASS: ${checks} fullscreen geometry checks, live landscape/portrait streams, resize, native/overlay, controls visible/hidden`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
