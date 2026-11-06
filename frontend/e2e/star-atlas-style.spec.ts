import { expect, test } from '@playwright/test';

for (const width of [320, 393, 1024, 1440]) {
  test(`switch Star Atlas style without losing chat at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const user = { id: 'fixture', nick: 'Тест', email: 'test@example.test', is_admin: true };
    await page.addInitScript((user) => {
      localStorage.setItem('tescord.session', JSON.stringify({ access_token: 'fixture', user }));
    }, user);
    await page.route('**/api/**', (r) => {
      const path = new URL(r.request().url()).pathname;
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
                id: 'atlas-message',
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
    await page.getByRole('radio', { name: /Звёздный атлас/ }).check();
    await expect(page.locator('html')).toHaveAttribute('data-ui-style', 'star-atlas');
    await page.screenshot({ path: testInfo.outputPath(`atlas-picker-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(composer).toHaveValue('Черновик остаётся при смене стиля');
    await expect(page.locator('.conversation-stream')).toHaveCSS(
      'background-color',
      'rgb(245, 231, 207)',
    );
    await expect(page.locator('.composer__submit')).toHaveCSS('color', 'rgb(255, 245, 223)');
    await expect(page.locator('.composer__submit app-ui-icon path').first()).toHaveAttribute(
      'fill-rule',
      'evenodd',
    );
    const roomIcon = nav.locator('img[src$="/room-128.webp"]');
    await expect(roomIcon).toHaveCSS('content', /star-atlas\/room-night.svg/);
    await expect(roomIcon).toHaveCSS('background-image', 'none');
    if (width > 980) {
      for (const height of [1080, 900, 800, 768, 720, 650, 600, 540]) {
        await page.setViewportSize({ width, height });
        const rail = page.locator('app-section-navigation nav');
        expect(await rail.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBeTruthy();
        await expect(
          nav.getByRole('button', { name: 'Меню приложения', exact: true }),
        ).toBeInViewport();
        const buttons = await nav
          .locator('button')
          .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        expect(Math.min(...buttons)).toBeGreaterThanOrEqual(44);
      }
      await page.setViewportSize({ width, height: 768 });
      await page.screenshot({ path: testInfo.outputPath(`atlas-rail-${width}.png`) });
      await page.setViewportSize({ width, height: 900 });
    }
    await page.screenshot({ path: testInfo.outputPath(`atlas-chat-${width}.png`) });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ui-style', 'star-atlas');
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
