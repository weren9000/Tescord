// Local fixture only: header icon geometry and unified inventory/store entry.
const { chromium, expect } = require('../frontend/node_modules/@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync('.local/workspace-navigation', { recursive: true });
  try {
    for (const width of [1440, 393, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', r => {
        const path = new URL(r.request().url()).pathname;
        const data = path.includes('/inventory') || path === '/api/shop'
          ? { items: [], page: 1, pages: 1, total: 0, categories: {}, notifications: [], unread: 0, equipped_ids: [] }
          : path.includes('/wallet') ? { coins: 0, crystals: 0 } : [];
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.goto('http://127.0.0.1:4217/login');
      await page.waitForFunction(() => window.ng?.getComponent?.(document.querySelector('app-root')));
      await page.evaluate(() => {
        const a = ng.getComponent(document.querySelector('app-root')); window.fixture = a;
        a.session.set({ access_token: 'fixture' });
        a.currentUser.set({ id: 'self', nick: 'Test', email: 'test@example.test' });
        ng.applyChanges(a);
      });
      await page.waitForTimeout(600);
      await page.evaluate(() => { fixture.currentUserAvatarUrl = () => '/assets/kva-wordmark-v2.png'; ng.applyChanges(fixture); });
      const menuButton = page.getByRole('button', { name: 'Меню приложения', exact: true });
      await expect(menuButton).toHaveCount(1);
      if (width <= 980) {
        const footer = page.locator('.mobile-mode-footer');
        await expect(footer.locator('button')).toHaveCount(5);
        assert.equal((await footer.innerText()).trim(), '');
        await expect(footer.getByRole('button', { name: 'Уведомления', exact: true })).toHaveCount(0);
        await expect(footer.getByRole('button', { name: 'Моя комната', exact: true })).toBeVisible();
        const sizes = await footer.locator('button').evaluateAll(es => es.map(e => ({ w: e.clientWidth, h: e.clientHeight, icon: e.querySelector('svg').getBoundingClientRect().width })));
        assert(sizes.every(s => s.w >= 44 && s.h >= 44 && s.icon >= 22), JSON.stringify(sizes));
        await page.screenshot({ path: `.local/workspace-navigation/footer-${width}.png` });
      }
      await menuButton.locator(width > 980 ? 'img' : 'app-ui-icon').click();
      const menu = page.getByRole('dialog', { name: 'Меню', exact: true });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Моя комната', exact: true })).toHaveCount(0);
      const balance = menu.getByRole('button', { name: 'Открыть кошелёк', exact: true });
      const walletBox = await balance.boundingBox();
      const profileBox = await menu.getByRole('button', { name: 'Мой профиль', exact: true }).boundingBox();
      assert(walletBox.y + walletBox.height <= profileBox.y);
      await balance.click();
      await expect(page.getByRole('dialog', { name: 'Кошелёк', exact: true })).toBeVisible();
      await expect(menu).toHaveCount(0);
      await page.keyboard.press('Escape');
      await menuButton.click();
      await expect(menu.getByRole('button', { name: 'Уведомления', exact: true })).toBeVisible();
      await menu.getByRole('button', { name: 'Уведомления', exact: true }).click();
      await expect(page.locator('.modal--friend-requests')).toBeVisible();
      await expect(menu).toHaveCount(0);
      await page.locator('.modal--friend-requests .modal__header button').click();
      await menuButton.click();
      await menu.getByRole('button', { name: 'Мой профиль', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Мой профиль', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Закрыть профиль', exact: true }).click();
      await menuButton.focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      await page.evaluate(() => {
        fixture.notificationAlertCount = () => 3;
        fixture.inventoryUnread.set(1);
        fixture.isAdmin = () => true;
        fixture.pwa.installed = () => false;
        ng.applyChanges(fixture);
      });
      await expect(menu.locator('.account-menu__badge')).toHaveText(['3', '1']);
      await page.screenshot({ path: `.local/workspace-navigation/profile-menu-${width}.png` });
      if (width <= 980) {
        await page.setViewportSize({ width, height: 600 });
        const before = await balance.boundingBox();
        await menu.locator('.action-menu__body').evaluate(e => e.scrollTop = e.scrollHeight);
        const after = await balance.boundingBox();
        assert(Math.abs(before.y - after.y) < 1, 'Balance must remain pinned');
        await expect(menu.getByRole('button', { name: 'Выход', exact: true })).toBeInViewport();
        await page.screenshot({ path: `.local/workspace-navigation/menu-short-${width}.png` });
        await page.setViewportSize({ width, height: 900 });
      }
      await page.evaluate(() => { fixture.notificationAlertCount = () => 0; fixture.inventoryUnread.set(0); fixture.isAdmin = () => false; ng.applyChanges(fixture); });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await page.evaluate(() => { fixture.currentUserAvatarUrl = () => null; ng.applyChanges(fixture); });
      await menuButton.locator(width > 980 ? 'b' : 'app-ui-icon').click();
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await page.evaluate(() => {
        const a = fixture;
        a.activeServer = () => ({ id: 'group', name: 'Group', kind: 'group' });
        a.activeGroupConversation = () => ({ id: 'group', name: 'Group' });
        a.activeGroupVoiceChannel = () => ({ id: 'voice', name: 'Call' });
        a.activeChannel = () => ({ id: 'text', type: 'text', name: 'Chat' });
        a.isGroupsMode = () => true; a.isChatsMode = () => false; a.isPlatformsMode = () => false;
        ng.applyChanges(a);
      });
      await page.locator('.group-voice-card__actions').waitFor();
      const icons = await page.locator('.group-voice-card__action').evaluateAll(es => es.map(e => {
        const b = e.getBoundingClientRect(), i = e.querySelector('svg,img').getBoundingClientRect();
        return { button: b.width, icon: i.width, inside: i.left >= b.left && i.right <= b.right };
      }));
      assert(icons.length === 3 && icons.every(i => i.button >= 44 && i.icon >= 18 && i.inside), JSON.stringify(icons));
      await page.screenshot({ path: `.local/workspace-navigation/icons-${width}.png` });
      if (width > 980) {
        const nav = page.getByRole('navigation', { name: 'Основные разделы' });
        await expect(nav.getByRole('button', { name: 'Инвентарь', exact: true })).toHaveCount(0);
        await nav.getByRole('button', { name: 'Предметы', exact: true }).click();
      } else {
        await menuButton.click();
        await page.getByRole('button', { name: 'Предметы', exact: true }).click();
      }
      const tabs = page.locator('app-shop .section-links');
      await expect(tabs.locator('button').first()).toHaveText('Мой инвентарь');
      await expect(tabs.locator('button.active')).toHaveText('Мой инвентарь');
      await expect(page.locator('#shop-title')).toHaveText('Предметы');
      await expect(tabs.getByRole('button', { name: 'Права', exact: true })).toHaveCount(0);
      await page.screenshot({ path: `.local/workspace-navigation/items-${width}.png` });
      await page.locator('app-shop').getByRole('button', { name: 'Открыть магазин', exact: true }).first().click();
      await expect(tabs.locator('button.active')).toHaveText('Витрина');
      const search = page.locator('app-shop .search-field input');
      await search.fill('Saved filter');
      await tabs.getByRole('button', { name: 'Мой инвентарь', exact: true }).click();
      await tabs.getByRole('button', { name: 'Витрина', exact: true }).click();
      await expect(search).toHaveValue('Saved filter');
      await page.getByRole('button', { name: 'Закрыть предметы', exact: true }).click();
      await expect(page.locator('app-shop')).toHaveCount(0);
      await page.waitForTimeout(200);
      await page.evaluate(() => { fixture.shopInitialMode.set('inventory'); fixture.shopOpen.set(true); ng.applyChanges(fixture); });
      await expect(tabs.locator('button.active')).toHaveText('Мой инвентарь');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      if (width <= 980) {
        await page.getByRole('button', { name: 'Закрыть предметы', exact: true }).click();
        await page.evaluate(() => { fixture.friendRequestBadgeVisible = () => true; ng.applyChanges(fixture); });
        await expect(menuButton.locator('.mobile-mode-footer__badge')).toBeVisible();
        await page.route('**/my-room', r => r.fulfill({ contentType: 'text/html', body: '<h1>Room route fixture</h1>' }));
        await page.locator('.mobile-mode-footer').getByRole('button', { name: 'Моя комната', exact: true }).click();
        await expect(page).toHaveURL(/\/my-room$/);
      }
      await page.close();
    }
    console.log('PASS: visible group icons, one items entry, inventory default, browse link, filters, permissions, desktop/mobile');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
