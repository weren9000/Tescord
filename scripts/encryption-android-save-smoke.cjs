require('./encryption-smoke-utils.cjs');
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const {execFileSync}=require('node:child_process');const path=require('node:path');
const adb=path.resolve(__dirname,'../.tools/sdk/platform-tools/adb.exe');
const command=(...args)=>execFileSync(adb,args,{timeout:15000});
(async()=>{
 const pid=command('shell','pidof','ru.kvachat.encryptioncheck').toString().trim();
 command('forward','tcp:9229','localabstract:webview_devtools_remote_'+pid);
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9229',{noDefaults:true});
 const name='kva-encryption-test-'+Date.now()+'.bin';
 try{
  const page=browser.contexts()[0].pages()[0];
  const selected=page.evaluate(name=>window.kvaDesktop.beginSecretDownload(name,1048583),name);selected.catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,1800));
  command('shell','uiautomator','dump','/sdcard/kva-test-ui.xml');
  const xml=command('shell','cat','/sdcard/kva-test-ui.xml').toString();
  const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]).find(s=>/text="(?:SAVE|Save|Сохранить|СОХРАНИТЬ)"/.test(s));
  if(!node)throw Error('Android save action not found');
  const [,x1,y1,x2,y2]=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).map(Number);
  command('shell','input','tap',String(Math.round((x1+x2)/2)),String(Math.round((y1+y2)/2)));
  const id=await Promise.race([selected,new Promise((_,reject)=>setTimeout(()=>reject(Error('Save picker did not complete')),10000))]);
  expect(typeof id).toBe('string');
  const result=await page.evaluate(async id=>{const b=window.kvaDesktop;
    return {wrong:await b.writeSecretDownload(id,3,new Uint8Array(7)),first:await b.writeSecretDownload(id,0,new Uint8Array(1048576).fill(31)),last:await b.writeSecretDownload(id,1,new Uint8Array(7).fill(32)),done:await b.endSecretDownload(id,true)};
  },id);
  expect(result).toEqual({wrong:false,first:true,last:true,done:true});
  const data=execFileSync(adb,['exec-out','cat','/sdcard/Download/'+name],{maxBuffer:2*1024*1024});
  expect(data.length).toBe(1048583);expect(data[0]).toBe(31);expect(data.at(-1)).toBe(32);
  command('shell','rm','/sdcard/Download/'+name);
  console.log('Android: system document picker, bounded chunk writes, ordering validation and complete file bytes passed.');
 }finally{await browser.close();command('forward','--remove','tcp:9229');}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
