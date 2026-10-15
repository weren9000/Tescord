const {_electron:electron}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const fixture=JSON.parse(fs.readFileSync(process.env.KVA_TEST_FIXTURE,'utf8'));
const component="ng.getComponent(document.querySelector('app-root'))";
const instances=[];const profiles=[];
async function launch(index,profile){
 const env={...process.env,KVA_DESKTOP_TEST:'1',KVA_DESKTOP_TEST_URL:'http://localhost:4200',KVA_DESKTOP_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({args:[root,'--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'],env,timeout:60000});instances.push(app);
 const page=await app.firstWindow();
 if(index!==null){await page.getByLabel('Email',{exact:true}).fill(fixture.users[index].form.email);await page.getByLabel('Пароль',{exact:true}).fill(fixture.users[index].form.password);await page.getByRole('button',{name:'Войти',exact:true}).click();}
 await page.locator('.messenger-shell').waitFor({timeout:30000});
 return {app,page};
}
(async()=>{
 for(let i=0;i<2;i++)profiles.push(fs.mkdtempSync(path.join(os.tmpdir(),'kva-desktop-integration-')));
 const peers=[await launch(0,profiles[0]),await launch(1,profiles[1])];
 const channel=fixture.channels.find(c=>c.type==='voice');
 for(const {page} of peers){
  await page.locator('app-section-navigation').getByRole('button',{name:'Площадки',exact:true}).click();
  const choices=await page.evaluate(component+'.platformChoices()');
  const target=choices.find(x=>x.id===fixture.space.id);
  await page.locator('app-platform-list').getByRole('button',{name:target.name,exact:true}).click();
  await page.locator('button.space-channel').filter({has:page.locator('.space-channel__name',{hasText:channel.name})}).click();
  await page.locator('.space-voice-preview').getByRole('button',{name:'Присоединиться',exact:true}).click();
  await page.waitForFunction(component+".voiceState()==='connected'",{timeout:30000});
 }
 for(const {page} of peers)await page.waitForFunction(component+'.voiceRoom.remoteAudioOutputs.size>0',{timeout:30000});
 const owner=peers[0];
 const chooserPromise=owner.app.waitForEvent('window');
 await owner.page.evaluate(component+'.toggleActiveCallScreenShare()');
 const chooser=await chooserPromise;
 await chooser.locator('#sources button').first().waitFor({timeout:20000});
 // Share only this test application's window, never another user's window.
 const target=chooser.locator('#sources button').filter({hasText:'KVA Chat'}).first();
 await target.click({noWaitAfter:true});
 await owner.page.waitForFunction(component+'.voiceScreenSharing()',{timeout:30000});
 await peers[1].page.waitForFunction(component+'.voiceRoom.remoteScreenShareTracks.size>0',{timeout:30000});
 await owner.page.evaluate(component+'.toggleActiveCallScreenShare()');
 await owner.page.waitForFunction('!'+component+'.voiceScreenSharing()');
 for(const {page} of peers)await page.evaluate(component+'.endActiveCall()');
 assert.equal(await owner.page.evaluate(()=>localStorage.getItem('tescord.session')),null);
 const disk=fs.readFileSync(path.join(profiles[0],'session.bin'));assert(!disk.includes(Buffer.from('access_token')));
 await owner.app.close();instances.splice(instances.indexOf(owner.app),1);
 const restored=await launch(null,profiles[0]);
 assert(await restored.page.evaluate(component+'.currentUser().id')===fixture.users[0].user.id);
 await restored.page.evaluate(component+'.logout()');
 await restored.page.getByLabel('Email',{exact:true}).waitFor();assert(!fs.existsSync(path.join(profiles[0],'session.bin')));
 console.log('PASS: two Electron clients, login, LiveKit audio, window sharing, encrypted session across restart, logout clears session');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{for(const app of instances)await app.close().catch(()=>{});});
