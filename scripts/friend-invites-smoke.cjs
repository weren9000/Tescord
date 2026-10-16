const {chromium} = require('../desktop/node_modules/playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fixture = JSON.parse(fs.readFileSync(process.env.KVA_TEST_FIXTURE, 'utf8'));
const base = 'http://localhost:4200', api = 'http://127.0.0.1:8000';
(async () => {
 const browser = await chromium.launch({executablePath: 'C:/Users/admin/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe', headless: true});
 let group;
 try {
  const a = await browser.newPage(), b = await browser.newPage();
  const errors = [];
  for (const [page, index] of [[b, 1], [a, 0]]) {
   page.on('pageerror', error => errors.push(error.message));
   await page.goto(base + '/login');
   await page.getByLabel('Email', {exact: true}).fill(fixture.users[index].form.email);
   await page.getByLabel('Пароль', {exact: true}).fill(fixture.users[index].form.password);
   await page.getByRole('button', {name: 'Войти', exact: true}).click();
   await page.locator('app-section-navigation').waitFor();
  }
  const session = JSON.parse(await a.evaluate(() => localStorage.getItem('tescord.session')));
  const headers = {Authorization: 'Bearer ' + session.access_token};
  await b.locator('app-section-navigation').getByRole('button', {name: 'Друзья', exact: true}).click();
  await b.locator('app-conversation-list').getByRole('button', {name: fixture.users[0].user.nick, exact: true}).locator('.presence.online').waitFor();
  const result = await a.request.post(api + '/api/conversations/group', {headers, data: {name: 'Invite UI ' + Date.now()}});
  assert.equal(result.status(), 201);
  group = await result.json();
  const target = `/channels/${group.id}/${group.primary_channel_id}`;
  await a.goto(base + target);
  await a.getByRole('button', {name: 'Пригласить', exact: true}).first().click();
  await a.getByRole('dialog', {name: 'Пригласить'}).waitFor();
  await a.getByRole('checkbox', {name: fixture.users[1].user.nick, exact: true}).check();
  await a.getByRole('button', {name: 'Пригласить · 1', exact: true}).click();
  await a.getByText('Приглашения отправлены', {exact: true}).waitFor();
  await b.locator('app-section-navigation').getByRole('button', {name: 'Уведомления', exact: true}).click();
  await b.getByText(group.title, {exact: true}).waitFor();
  await b.getByRole('button', {name: 'Принять', exact: true}).click();
  await b.waitForURL(base + target);
  await b.locator('textarea').first().waitFor();
  await a.setViewportSize({width: 393, height: 851});
  assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await a.screenshot({path: 'D:/Code/Kva/auth-review/friend-invite-mobile.png'});
  assert.deepEqual(errors, []);
  console.log('PASS: friend online, send invitation, realtime inbox, accept -> channel, mobile layout');
 } finally {
  await browser.close();
  if (group) execFileSync('C:/Users/admin/AppData/Local/Temp/kva-review-e483edaa03cd4785a1d9d0a2d1546a92/venv/Scripts/python.exe', ['-c',
   `from uuid import UUID\nfrom app.db.session import SessionLocal\nfrom app.db.models import Server\nwith SessionLocal() as db:\n s=db.get(Server,UUID('${group.id}'))\n assert s.name.startswith('Invite UI ')\n db.delete(s)\n db.commit()`],
   {cwd: 'D:/Code/Kva/Tescord/backend', env: {...process.env, TESCORD_DATABASE_URL: 'postgresql+psycopg://audit@127.0.0.1:55432/kva_fix'}});
 }
})().catch(error => {console.error(error);process.exitCode = 1;});
