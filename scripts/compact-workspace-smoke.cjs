// Local fixtures only: compact forms must retain their actions and validation.
const { chromium, expect } = require('../frontend/node_modules/@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync('.local/compact-workspace', { recursive: true });
  try {
    for (const width of [1440, 393, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [], submitted = [];
      let failChat = true;
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', r => {
        const path = new URL(r.request().url()).pathname;
        if (path.endsWith('/chats') && r.request().method() === 'POST') {
          submitted.push(r.request().postDataJSON());
          return r.fulfill({ status: failChat ? 400 : 200, contentType: 'application/json', body: JSON.stringify(failChat ? { detail: 'Название уже занято' } : { id: 'created' }) });
        }
        const data = path.includes('/inventory') || path === '/api/shop'
          ? { items: [], page: 1, pages: 1, total: 0, categories: {}, notifications: [], unread: 0, equipped_ids: [] }
          : path.includes('/wallet') ? { coins: 0, crystals: 680, items: [], page: 1, pages: 1 } : [];
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.goto('http://127.0.0.1:4217/login');
      await page.waitForFunction(() => window.ng?.getComponent?.(document.querySelector('app-root')));
      await page.evaluate(() => {
        window.fixture = ng.getComponent(document.querySelector('app-root'));
        fixture.session.set({ access_token: 'fixture' });
        fixture.currentUser.set({ id: 'self', nick: 'Test', email: 'test@example.test' });
        fixture.shopInitialMode.set('inventory'); fixture.shopOpen.set(true); ng.applyChanges(fixture);
      });
      const shop = page.locator('app-shop');
      await expect(shop.getByRole('button', { name: 'Мой инвентарь', exact: true })).toBeVisible();
      await expect(shop.locator('.inventory-heading')).toHaveCount(0);
      await page.screenshot({ path: `.local/compact-workspace/inventory-${width}.png` });
      for (const label of ['Витрина', 'Предложения', 'Покупки', 'Журнал']) {
        await shop.getByRole('button', { name: label, exact: true }).click();
        await expect(shop.locator('.collection-banner')).toHaveCount(0);
        await expect(shop.locator('.section-heading h3')).toHaveCount(0);
        await page.screenshot({ path: `.local/compact-workspace/shop-${label === 'Предложения' ? 'offers' : label === 'Витрина' ? 'browse' : label === 'Покупки' ? 'purchases' : 'journal'}-${width}.png` });
      }
      await shop.getByRole('button', { name: 'Закрыть предметы', exact: true }).click();
      await page.evaluate(() => {
        fixture.isPlatformsMode = () => true;
        fixture.isGroupsMode = () => false;
        fixture.isChatsMode = () => false;
        fixture.activePlatform = () => ({ id: 'space', name: 'Test platform', member_role: 'owner' });
        fixture.selectedPlatformChats = () => [];
        fixture.mobilePanel.set('servers'); fixture.platformBrowserStage.set('channels');
        ng.applyChanges(fixture);
      });
      const platforms = page.locator('app-platform-chats');
      await platforms.getByRole('button', { name: 'Создать чат', exact: true }).click();
      const dialog = platforms.locator('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('input')).toHaveCount(1);
      await expect(dialog.locator('button')).toHaveCount(2);
      await expect(dialog.getByRole('button', { name: 'Создать чат', exact: true })).toBeDisabled();
      await expect(dialog.getByPlaceholder('Название чата')).toBeVisible();
      await page.screenshot({ path: `.local/compact-workspace/new-chat-${width}.png` });
      assert((await dialog.boundingBox()).height < 260, JSON.stringify(await dialog.evaluate(e => ({height: e.offsetHeight, min: getComputedStyle(e).minHeight, body: e.querySelector('.dialog-body').offsetHeight, header: e.querySelector('header').offsetHeight}))));
      await page.evaluate(() => {
        window.platformFixture = ng.getComponent(document.querySelector('app-platform-chats'));
        platformFixture.refresh = async () => {};
      });
      await dialog.getByPlaceholder('Название чата').fill('Test chat');
      await dialog.getByRole('button', { name: 'Создать чат', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('Название уже занято');
      failChat = false;
      await dialog.getByRole('button', { name: 'Создать чат', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      assert.equal(submitted.at(-1).name, 'Test chat');
      await page.evaluate(() => { platformFixture.show('create'); ng.applyChanges(platformFixture); });
      await expect(dialog.getByPlaceholder('Название площадки')).toBeVisible();
      await page.screenshot({ path: `.local/compact-workspace/new-platform-${width}.png` });
      await dialog.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
      await platforms.getByRole('button', { name: 'Настройки площадки', exact: true }).click();
      await page.screenshot({ path: `.local/compact-workspace/settings-${width}.png` });
      await page.keyboard.press('Escape');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: compact store, chat validation/error/retry/create, platform form/settings, desktop and mobile');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
