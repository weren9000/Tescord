import { expect, test } from '@playwright/test';

for (const width of [320, 393, 1024, 1440]) {
  test(`switch Quiet Marsh style without losing chat at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const user = { id: 'fixture', nick: 'Тест', email: 'test@example.test', is_admin: true };
    await page.addInitScript((user) => {
      localStorage.setItem('tescord.session', JSON.stringify({ access_token: 'fixture', user }));
    }, user);
    await page.route('**/api/**', (r) => {
      const path = new URL(r.request().url()).pathname;
      if (path.includes('/avatar'))
        return r.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#31483f"/><circle cx="16" cy="12" r="6" fill="#c2ddc7"/><path d="M5 30v-5a11 9 0 0 1 22 0v5" fill="#c2ddc7"/></svg>',
        });
      if (path === '/api/conversations')
        return r.fulfill({
          json: [
            {
              id: 'chat0',
              title: 'Свои люди',
              kind: 'group_chat',
              primary_channel_id: 'text0',
              member_role: 'owner',
              members: [],
              unread_count: 0,
            },
          ],
        });
      if (path === '/api/servers/chat0/channels')
        return r.fulfill({
          json: [
            { id: 'text0', server_id: 'chat0', name: 'Общий', type: 'text', position: 0 },
            { id: 'voice0', server_id: 'chat0', name: 'Созвон', type: 'voice', position: 1 },
          ],
        });
      if (path.includes('/messages'))
        return r.fulfill({
          json: {
            items: [
              {
                id: 'marsh-message',
                channel_id: 'text0',
                type: 'text',
                content: 'Встречаемся вечером у обсерватории',
                created_at: '2026-11-04T10:00:00Z',
                edited_at: null,
                author: { id: 'friend', nick: 'Друг', public_id: 2 },
                attachments: [],
                reactions: [],
                read_by: [],
                mentioned_user_ids: [],
                reply_to: null,
              },
              {
                id: 'marsh-own-message',
                channel_id: 'text0',
                type: 'text',
                content: 'Я здесь, присоединяйся!',
                created_at: '2026-11-04T10:01:00Z',
                edited_at: null,
                author: { id: 'fixture', nick: 'Тест', public_id: 1 },
                attachments: [],
                reactions: [],
                read_by: [],
                mentioned_user_ids: [],
                reply_to: null,
              },
            ],
            has_more: false,
            next_cursor: null,
          },
        });
      if (path === '/api/inventory') return r.fulfill({ json: { items: [], pages: 1 } });
      if (path === '/api/inventory/theme')
        return r.fulfill({
          json: {
            id: 'theme-viking',
            scheme: 'dark',
            palette: { canvas: '#141d24', text: '#f2eee3' },
          },
        });
      if (path === '/api/wallet') return r.fulfill({ json: { coins: 0, crystals: 680 } });
      return r.fulfill({
        json: ['/api/me', '/api/users/me', '/api/auth/me'].includes(path) ? user : [],
      });
    });
    await page.goto('/login');
    const nav = page.locator(width > 980 ? 'app-section-navigation' : '.mobile-mode-footer');
    await nav.getByRole('button', { name: 'Группы', exact: true }).click();
    const composer = page.locator('.composer textarea');
    // The only group is opened automatically; its mobile drawer then closes.
    await expect(composer).toBeVisible();
    await composer.fill('Черновик остаётся при смене стиля');

    const openAppearance = async () => {
      await nav.getByRole('button', { name: 'Меню приложения', exact: true }).click();
      await page
        .locator('.action-menu--account')
        .getByRole('button', { name: 'Оформление', exact: true })
        .click();
      await expect(page.getByRole('dialog', { name: 'Оформление', exact: true })).toBeVisible();
    };
    await openAppearance();
    await page.getByRole('radio', { name: /Тихое болото/ }).check();
    await expect(page.locator('html')).toHaveAttribute('data-ui-style', 'quiet-marsh');
    await page.screenshot({ path: testInfo.outputPath(`marsh-picker-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(composer).toHaveValue('Черновик остаётся при смене стиля');
    await expect(page.locator('.conversation-stream')).toHaveCSS(
      'background-color',
      'rgb(16, 27, 26)',
    );
    await expect(page.locator('.composer__submit')).toHaveCSS('color', 'rgb(16, 35, 27)');
    await expect(page.locator('.message-card--self .message-card__body')).toHaveCSS(
      'background-color',
      'rgb(73, 63, 86)',
    );
    await expect(page.locator('.composer__submit app-ui-icon path')).toHaveAttribute(
      'stroke-width',
      '1.65',
    );
    const roomIcon = nav.locator('img[src$="/room-128.webp"]');
    await expect(roomIcon).toHaveCSS('content', /quiet-marsh\/room.svg/);
    await expect(roomIcon).toHaveCSS('background-image', 'none');
    // Wait for the actual replacement asset, not just its CSS declaration.
    await page.evaluate(async () => {
      const icon = new Image();
      icon.src = '/assets/quiet-marsh/room.svg';
      await icon.decode();
    });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath(`marsh-chat-${width}.png`) });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ui-style', 'quiet-marsh');
    await openAppearance();
    await page.getByRole('radio', { name: /Эмаль/ }).check();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-ui-style', 'enamel');
    await expect(roomIcon).toHaveCSS('content', 'normal');
    expect(await page.evaluate(() => localStorage.getItem('kva.interface-style.v1'))).toBe(
      'enamel',
    );
  });
}

test('navigation silhouettes are available and readable at native sizes', async ({
  page,
}, testInfo) => {
  await page.goto('/login');
  await page.evaluate(() => {
    const names = [
      'room',
      'friends',
      'groups',
      'platforms',
      'inventory',
      'applications',
      'security',
      'search',
      'bell',
      'menu',
      'profile',
      'appearance',
      'sound',
      'block',
      'logout',
      'install',
    ];
    document.body.innerHTML = '';
    document.body.style.cssText =
      'background:#182623;color:#f0eee3;font:16px system-ui;padding:32px';
    for (const size of [24, 32, 40]) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:24px;margin:32px 0';
      for (const name of names) {
        const cell = document.createElement('div');
        cell.style.cssText = 'width:88px;display:grid;gap:12px;justify-items:center';
        const icon = document.createElement('img');
        icon.src = `/assets/quiet-marsh/${name}.svg`;
        icon.width = icon.height = size;
        icon.alt = name;
        cell.append(icon, document.createTextNode(name));
        row.append(cell);
      }
      document.body.append(document.createTextNode(`${size}px`), row);
    }
  });
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images).map((image) => image.decode()));
  });
  await page.screenshot({ path: testInfo.outputPath('marsh-icon-sizes.png'), fullPage: true });
});
