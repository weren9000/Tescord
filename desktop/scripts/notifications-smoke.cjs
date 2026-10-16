const {_electron: electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kva-notifications-'));
let app;
async function launch() {
  const env = {...process.env, KVA_DESKTOP_TEST: '1', KVA_DESKTOP_PROFILE: profile};
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({...process.env.KVA_SMOKE_EXE ? {executablePath: process.env.KVA_SMOKE_EXE, args: ['--user-data-dir='+profile]} : {args: [root]}, env});
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
  const page = await app.firstWindow();
  await page.getByLabel('Email', {exact: true}).waitFor();
  await app.evaluate(({Notification, BrowserWindow}) => {
    globalThis.testNotifications = [];
    globalThis.testFailures = [];
    const original = Notification.prototype.show;
    Notification.prototype.show = function () {
      globalThis.testNotifications.push(this);
      this.on('failed', (_event, error) => globalThis.testFailures.push(error));
      return original.call(this);
    };
    BrowserWindow.getAllWindows()[0].hide();
  });
  return page;
}
(async () => {
  const page = await launch();
  await page.evaluate(() => window.kvaDesktop.onNotificationOpen(target => window.clickedNotification = target));
  const item = {id: 'test-message-1', title: 'KVA Chat — проверка', body: 'Тест уведомлений Windows', target: 'test-chat'};
  assert.equal(await page.evaluate(item => window.kvaDesktop.notify(item), item), true);
  assert.equal(await page.evaluate(item => window.kvaDesktop.notify(item), item), false);
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.deepEqual(await app.evaluate(() => globalThis.testFailures), []);
  assert.equal(await app.evaluate(() => globalThis.testNotifications.length), 1);
  // Exercise the native click handler without interacting with unrelated OS notifications.
  await app.evaluate(() => globalThis.testNotifications[0].emit('click'));
  await page.waitForFunction(() => window.clickedNotification === 'test-chat');
  assert.equal(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].focus());
  assert.equal(await page.evaluate(item => window.kvaDesktop.notify({...item, id: 'focused'}), item), false);
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].hide());
  assert.equal(await page.evaluate(() => window.kvaDesktop.notify({id: 'call-1', title: 'Входящий звонок', body: 'Тест', target: 'call'})), true);
  await page.evaluate(() => window.kvaDesktop.clearNotifications('call'));
  await page.evaluate(() => window.kvaDesktop.writeSession(null));
  await app.close(); app = null;
  fs.writeFileSync(path.join(profile, 'notifications.json'), JSON.stringify({enabled: false}));
  const disabled = await launch();
  assert.equal(await disabled.evaluate(item => window.kvaDesktop.notify(item), item), false);
  assert.equal(await app.evaluate(() => globalThis.testNotifications.length), 0);
  console.log('PASS: native notification API, duplicate suppression, click routing, focused-window suppression, call dismissal, persisted disable');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(async () => {if (app) await app.close();});
