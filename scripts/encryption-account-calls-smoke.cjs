const {chromium, expect} = require('../frontend/node_modules/@playwright/test');
const {uiBase, fixture, output, api, login, instrument, verify} = require('./encryption-smoke-utils.cjs');
(async () => {
  const sessions = await Promise.all([login(0), login(1), login(2)]);
  const direct = await api('/conversations/direct', sessions[0].access_token, {user_id: fixture.users[1].id});
  const group = await api('/conversations/group', sessions[0].access_token, {name: 'Encrypted group ' + Date.now(), member_ids: fixture.users.slice(1,3).map(u=>u.id)});
  const channels = await api('/servers/' + group.id + '/channels', sessions[0].access_token, undefined, 'GET');
  const text = channels.find(c => c.type === 'text');
  const browser = await chromium.launch({headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio']});
  const pages = [];
  try {
    for (const session of sessions) {
      const context = await browser.newContext({viewport: {width: 1440, height: 1000}});await instrument(context);
      await context.addInitScript(s => localStorage.setItem('tescord.session', JSON.stringify(s)), session);
      pages.push(await context.newPage());
    }
    const [a, b] = pages;
    for (const page of [a, b]) await page.goto(`${uiBase}/channels/${direct.id}/${direct.primary_channel_id}`);
    for (const page of [a, b]) await page.waitForFunction(() => window.testCallReady);
    await a.getByRole('button', {name: 'Позвонить', exact: true}).first().click();
    await b.getByRole('button', {name: 'Ответить', exact: true}).first().click();
    await verify([a, b]);
    await a.getByRole('button', {name: 'Включить камеру', exact: true}).first().click();
    await b.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth > 0));
    await a.getByRole('button', {name: 'Показать экран', exact: true}).first().click();
    await b.waitForFunction(() => [...document.querySelectorAll('.direct-call-screen video')].some(v => v.videoWidth > 0));
    await a.getByRole('button', {name: 'Остановить показ экрана', exact: true}).first().click();
    await b.waitForFunction(() => !document.querySelector('.direct-call-screen video'));
    await a.getByRole('button', {name: 'Завершить звонок', exact: true}).first().click();
    for (const page of [a, b]) await page.waitForFunction(() => window.testPeers.every(pc => pc.connectionState === 'closed'));
    // Start a fresh call to check ephemeral identity disposal and reconnect.
    await a.getByRole('button', {name: 'Позвонить', exact: true}).first().click();
    await b.getByRole('button', {name: 'Ответить', exact: true}).first().click();await verify([a, b]);
    await a.getByRole('button', {name: 'Завершить звонок', exact: true}).first().click();
    for (const page of pages) {
      await page.goto(`${uiBase}/channels/${group.id}/${text.id}`);
      await page.getByRole('button', {name: 'Присоединиться к групповому звонку', exact: true}).click();
      const expand = page.getByRole('button', {name: 'Развернуть звонок', exact: true});
      if (await expand.isVisible()) await expand.click();
    }
    await verify(pages);
    await a.getByRole('button', {name: 'Включить камеру', exact: true}).first().click();
    await b.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth > 0));
    await a.getByRole('button', {name: 'Показать экран', exact: true}).first().click();
    await expect(b.locator('.conference-stage--presentation')).toBeVisible();
    await a.getByRole('button', {name: 'Остановить показ экрана', exact: true}).first().click();
    await expect(b.locator('.conference-stage--presentation')).toHaveCount(0);
    await b.screenshot({path: output + '/group-encrypted.png'});
    for (const page of pages) await page.getByRole('button', {name: 'Завершить звонок', exact: true}).first().click();
    for (const page of pages) await page.waitForFunction(() => window.testPeers.every(pc => pc.connectionState === 'closed'));
    console.log('PASS encrypted direct and three-person group calls: PCM, camera, screen, direct rejoin, leave');
  } catch (error) {
    for (let i = 0; i < pages.length; i++) await pages[i].screenshot({path: output + '/account-call-failure-' + i + '.png'});
    throw error;
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode = 1;});
