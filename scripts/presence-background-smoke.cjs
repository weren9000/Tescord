const { chromium } = require('../desktop/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const fixture = JSON.parse(fs.readFileSync(process.env.KVA_TEST_FIXTURE, 'utf8'));

(async () => {
  const browser = await chromium.launch({executablePath: 'C:/Users/admin/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe', headless: true});
  try {
    const pages = [await browser.newPage(), await browser.newPage()];
    const errors = [];
    const heartbeats = [];
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', error => errors.push(error.message));
      if (index === 0) {
        await page.addInitScript(() => Object.defineProperty(document, 'visibilityState', {get: () => 'hidden'}));
        page.on('websocket', socket => {
          if (socket.url().includes('/api/events/ws')) socket.on('framesent', event => {
            if (JSON.parse(event.payload).type === 'activity') heartbeats.push(Date.now());
          });
        });
      }
      await page.goto('http://localhost:4200/login');
      await page.getByLabel('Email', {exact: true}).fill(fixture.users[index].form.email);
      await page.getByLabel('Пароль', {exact: true}).fill(fixture.users[index].form.password);
      await page.getByRole('button', {name: 'Войти', exact: true}).click();
      await page.locator('app-section-navigation').waitFor();
    }
    const observer = pages[1];
    await observer.locator('app-section-navigation').getByRole('button', {name: 'Друзья', exact: true}).click();
    const dot = observer.locator('app-conversation-list').getByRole('button', {name: fixture.users[0].user.nick, exact: true}).locator('.presence.online');
    await dot.waitFor();
    const started = Date.now();
    // Keep the source tab hidden beyond one heartbeat period, with no call or input.
    await new Promise(resolve => setTimeout(resolve, 65000));
    assert(heartbeats.some(time => time > started + 45000), 'Hidden tab did not send its minute heartbeat');
    await dot.waitFor();
    await observer.reload();
    await dot.waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: hidden idle tab heartbeat, friend online indicator, reload snapshot');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
