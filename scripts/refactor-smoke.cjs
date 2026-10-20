// Run only against a disposable local backend; creates two temporary test users.
const {chromium, request} = require('../desktop/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = 'http://127.0.0.1:8000/api';
const base = 'http://localhost:4200';

(async () => {
  const http = await request.newContext();
  const health = await (await http.get(api + '/health')).json();
  assert.equal(health.environment, 'development', 'Requires an isolated development backend');
  const browser = await chromium.launch({executablePath: process.env.KVA_CHROME, headless: true});
  const output = path.resolve(__dirname, '../.local/refactor-smoke');
  fs.mkdirSync(output, {recursive: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const suffix = Date.now().toString(36);
    const password = 'local-test-password-123';
    await page.goto(base + '/login');
    await page.getByRole('button', {name: 'Регистрация', exact: true}).click();
    await page.getByLabel('Email', {exact: true}).fill(`refactor-a-${suffix}@example.test`);
    await page.getByLabel('Пароль', {exact: true}).fill(password);
    await page.getByLabel('Подтверждение пароля', {exact: true}).fill(password);
    await page.getByLabel('Ник', {exact: true}).fill('RefactorA' + suffix);
    await page.getByRole('button', {name: 'Зарегистрироваться', exact: true}).click();
    await page.locator('.messenger-shell').waitFor({timeout: 30000});
    const first = await page.evaluate(() => JSON.parse(localStorage.getItem('tescord.session')));
    assert(first.access_token);

    async function post(url, data, token) {
      const response = await http.post(api + url, {data, headers: token ? {Authorization: 'Bearer ' + token} : {}});
      assert(response.ok(), `${url}: ${response.status()} ${await response.text()}`);
      return response.status() === 204 ? null : response.json();
    }
    const second = await post('/auth/register', {
      email: `refactor-b-${suffix}@example.test`, nick: 'RefactorB' + suffix,
      password, password_confirmation: password,
    });
    const invitation = await post('/friends/requests', {user_id: second.user.id}, first.access_token);
    await post(`/friends/requests/${invitation.id}/accept`, {}, second.access_token);
    const chat = await post('/conversations/direct', {user_id: second.user.id}, first.access_token);
    await page.goto(`${base}/channels/${chat.id}/${chat.primary_channel_id}`);
    const composer = page.getByPlaceholder('Введите сообщение', {exact: true});
    await composer.waitFor({timeout: 30000});
    const text = 'Refactor message ' + suffix;
    await composer.fill(text);
    await page.getByRole('button', {name: 'Отправить сообщение', exact: true}).click();
    await page.getByText(text, {exact: true}).first().waitFor();

    const filename = `refactor-${suffix}.txt`;
    await page.locator('input[type=file][multiple]').setInputFiles({
      name: filename, mimeType: 'text/plain', buffer: Buffer.from('Refactor attachment bytes'),
    });
    const uploaded = page.waitForResponse(r => r.request().method() === 'POST' &&
      r.url().endsWith(`/channels/${chat.primary_channel_id}/messages`));
    await page.getByRole('button', {name: 'Отправить сообщение', exact: true}).click();
    const response = await uploaded;
    assert.equal(response.status(), 201);
    const message = await response.json();
    const attachment = message.attachments[0];
    assert.equal(attachment.filename, filename);
    const download = await http.get(api + '/attachments/' + attachment.id,
      {headers: {Authorization: 'Bearer ' + second.access_token}});
    assert.equal(await download.text(), 'Refactor attachment bytes');

    await page.context().setOffline(true);
    const missed = 'Recovered message ' + suffix;
    const sent = await http.post(api + `/channels/${chat.primary_channel_id}/messages`, {
      headers: {Authorization: 'Bearer ' + second.access_token}, multipart: {content: missed},
    });
    assert.equal(sent.status(), 201);
    await page.context().setOffline(false);
    await page.getByText(missed, {exact: true}).first().waitFor({timeout: 30000});
    await page.reload();
    await page.getByText(text, {exact: true}).first().waitFor({timeout: 30000});
    await page.screenshot({path: path.join(output, 'chat-desktop.png')});
    await page.setViewportSize({width: 393, height: 851});
    await composer.waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path: path.join(output, 'chat-mobile.png')});

    await post('/auth/logout', {}, first.access_token);
    await page.reload();
    await page.getByLabel('Email', {exact: true}).waitFor({timeout: 30000});
    assert.equal(await page.evaluate(() => localStorage.getItem('tescord.session')), null);
    assert.deepEqual(errors, []);
    console.log('PASS: registration, friendship, direct chat, send, upload/download, reconnect, session restore/revocation, desktop/mobile layout');
  } finally {
    await browser.close();
    await http.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
