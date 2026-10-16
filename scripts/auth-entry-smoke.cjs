const {chromium} = require('../desktop/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = 'http://localhost:4200', api = 'http://127.0.0.1:8000';

(async () => {
  const browser = await chromium.launch({executablePath: process.env.KVA_CHROME || 'C:/Users/admin/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe', headless: true});
  const output = path.resolve(__dirname, '../../auth-review');
  fs.mkdirSync(output, {recursive: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('app-landing').waitFor();
    const logo = await page.locator('.guest-logo img').boundingBox();
    await page.locator('.guest-login').click();
    await page.getByLabel('Email', {exact: true}).waitFor();
    assert.deepEqual(await page.locator('.guest-logo img').boundingBox(), logo);
    assert.equal(await page.locator('.auth-brand').count(), 0);
    await page.screenshot({path: path.join(output, 'login-desktop.png')});
    await page.goBack();
    await page.locator('app-landing').waitFor();

    const missing = '/channels/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002';
    await page.goto(base + missing);
    for (const width of [320, 393, 768]) {
      await page.setViewportSize({width, height: 851});
      for (const tab of ['Регистрация', 'Вход']) {
        await page.getByRole('button', {name: tab, exact: true}).click();
        assert.equal(new URL(page.url()).pathname, missing);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
    }
    await page.setViewportSize({width: 393, height: 851});
    await page.screenshot({path: path.join(output, 'login-mobile.png')});
    await page.reload();
    await page.getByLabel('Email', {exact: true}).waitFor();
    assert.equal(new URL(page.url()).pathname, missing);

    if (process.env.KVA_TEST_FIXTURE) {
      const fixture = JSON.parse(fs.readFileSync(process.env.KVA_TEST_FIXTURE, 'utf8'));
      const form = fixture.users[0].form;
      const login = await page.request.post(api + '/api/auth/login', {data: {email: form.email, password: form.password}});
      assert(login.ok());
      const session = await login.json();
      const headers = {Authorization: `Bearer ${session.access_token}`};
      const conversations = await (await page.request.get(api + '/api/conversations', {headers})).json();
      const target = conversations.find(item => item.primary_channel_id);
      assert(target, 'Fixture needs a conversation');
      const destination = `/channels/${target.id}/${target.primary_channel_id}`;
      await page.goto(base + destination);
      await page.getByLabel('Email', {exact: true}).fill(form.email);
      await page.getByLabel('Пароль', {exact: true}).fill(form.password);
      await page.getByRole('button', {name: 'Войти', exact: true}).click();
      await page.locator('app-section-navigation').waitFor({state: 'attached'});
      await page.waitForFunction(() => !!document.querySelector('textarea'));
      assert.equal(new URL(page.url()).pathname, destination);
      await page.reload();
      await page.locator('app-section-navigation').waitFor({state: 'attached'});
      assert.equal(new URL(page.url()).pathname, destination);
      await page.route('**/api/servers', route => route.fulfill({status: 503, json: {detail: 'Temporary test outage'}, headers: {'Access-Control-Allow-Origin': base}}));
      await page.reload();
      await page.getByText('Temporary test outage', {exact: true}).waitFor();
      assert(await page.evaluate(() => !!localStorage.getItem('tescord.session')));
      assert.equal(await page.locator('.auth-page').count(), 0);
      await page.unroute('**/api/servers');
      for (const destination of [missing, `/channels/${target.id}/00000000-0000-0000-0000-000000000002`]) {
        await page.goto(base + destination);
        await page.getByText('Канал недоступен. Проверьте ссылку или попросите приглашение.', {exact: true}).waitFor().catch(async error => {
          console.error('Unavailable route:', destination, 'actual:', page.url());
          await page.screenshot({path: path.join(output, 'unavailable-debug.png')});
          throw error;
        });
        assert.equal(new URL(page.url()).pathname, destination);
      }
      const expired = await browser.newPage();
      await expired.addInitScript(session => localStorage.setItem('tescord.session', JSON.stringify({...session, access_token: 'expired-test-token'})), session);
      await expired.goto(base + destination);
      await expired.getByLabel('Email', {exact: true}).waitFor();
      assert.equal(new URL(expired.url()).pathname, destination);
      await expired.close();

      // Exercise the registration UI callback without creating a disposable account.
      const registration = await browser.newPage();
      await registration.route('**/api/auth/register', route => route.fulfill({json: session, headers: {
        'Access-Control-Allow-Origin': base,
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }}));
      await registration.goto(base + destination);
      await registration.getByRole('button', {name: 'Регистрация', exact: true}).click();
      await registration.getByLabel('Подтверждение пароля', {exact: true}).waitFor();
      await registration.getByLabel('Email', {exact: true}).fill(form.email);
      await registration.getByLabel('Пароль', {exact: true}).fill(form.password);
      await registration.getByLabel('Подтверждение пароля', {exact: true}).fill(form.password);
      await registration.getByLabel('Ник', {exact: true}).fill('Entry test');
      await registration.getByRole('button', {name: 'Зарегистрироваться', exact: true}).click();
      await registration.locator('app-section-navigation').waitFor({state: 'attached', timeout: 5000}).catch(async error => {
        console.error('Registration UI:', await registration.locator('.auth-error').allTextContents());
        await registration.screenshot({path: path.join(output, 'registration-debug.png')});
        throw error;
      });
      await registration.waitForFunction(() => !!document.querySelector('textarea'));
      assert.equal(new URL(registration.url()).pathname, destination);
      await registration.close();
      console.log('PASS: real login -> requested conversation, session reload, unavailable space/channel');
      console.log('PASS: expired session preserves URL; registration UI preserves URL (registration response stubbed)');
    }
    const native = await browser.newPage();
    await native.addInitScript(() => { window.kvaDesktop = {version: 'test', readSession: () => null, writeSession: () => true}; });
    await native.goto(base);
    await native.getByLabel('Email', {exact: true}).waitFor();
    assert.equal(await native.locator('app-landing').count(), 0);
    for (const route of ['/?friend=10001', '/invite/auth-invalid']) {
      const guest = await browser.newPage();
      await guest.goto(base + route);
      await guest.getByLabel('Email', {exact: true}).waitFor();
      assert.equal(await guest.locator('app-guest-header').count(), 1);
      await guest.close();
    }
    const staticPage = await browser.newPage({javaScriptEnabled: false});
    await staticPage.goto(base);
    assert.equal(await staticPage.locator('.guest-logo').count(), 1);
    assert.equal(await staticPage.locator('.landing-download').count(), 2);
    assert.deepEqual(errors, []);
    console.log('PASS: shared header, login/back, mobile, registration tab, reload, native entry, invitations, static landing');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
