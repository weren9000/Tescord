// Local test accounts and local services only; never writes production data.
const {_electron: electron} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const fixture = JSON.parse(fs.readFileSync(process.env.KVA_TEST_FIXTURE, 'utf8'));
const apps = [];
(async () => {
  const pages = [];
  for (const user of fixture.users.slice(0, 2)) {
    const env = {...process.env, KVA_DESKTOP_TEST: '1', KVA_DESKTOP_TEST_URL: 'http://localhost:4200', KVA_DESKTOP_PROFILE: fs.mkdtempSync(path.join(os.tmpdir(), 'kva-conference-'))};
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({args: [path.resolve(__dirname, '..'), '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], env});
    apps.push(app);
    const page = await app.firstWindow();
    pages.push(page);
    await page.getByLabel('Email', {exact: true}).fill(user.form.email);
    await page.getByLabel('Пароль', {exact: true}).fill(user.form.password);
    await page.getByRole('button', {name: 'Войти', exact: true}).click();
    await page.locator('app-section-navigation').getByRole('button', {name: 'Группы', exact: true}).click();
    await page.locator('app-conversation-list').getByRole('button', {name: fixture.groups[0].title, exact: true}).click();
    await page.getByRole('button', {name: 'Присоединиться к групповому звонку', exact: true}).click();
    await page.locator('button[aria-label="Включить камеру"]:not([disabled])').waitFor({timeout: 30000});
  }
  const [a, b] = pages;
  for (const page of pages) {
    await page.waitForFunction(() => document.querySelectorAll('.conference-tile').length === 2);
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(e => e.srcObject?.getAudioTracks().some(t => t.readyState === 'live') && !e.paused));
  }
  await a.getByRole('button', {name: 'Включить камеру', exact: true}).click();
  await b.waitForFunction(() => document.querySelector('.conference-tile video')?.videoWidth > 0);
  await a.getByRole('button', {name: 'Настройки звонка', exact: true}).click();
  await a.getByRole('combobox', {name: 'Камера звонка'}).waitFor();
  await a.keyboard.press('Escape');
  await a.getByRole('button', {name: 'Участники', exact: true}).click();
  await a.locator('.participant-menu-trigger').first().click();
  await a.getByRole('slider', {name: /^Громкость /}).waitFor();
  await a.keyboard.press('Escape');
  const chooserPromise = apps[0].waitForEvent('window');
  await a.getByRole('button', {name: 'Показать экран', exact: true}).click();
  const chooser = await chooserPromise;
  await chooser.locator('#sources button').filter({hasText: 'Квачат'}).first().click({noWaitAfter: true});
  await b.waitForFunction(() => document.querySelector('.conference-presentation video')?.videoWidth > 0);
  console.log('PASS: two Electron clients, local login, remote audio, camera, screen sharing, device settings and participant volume');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(async () => {
  for (const app of apps) await app.close().catch(() => {});
});
