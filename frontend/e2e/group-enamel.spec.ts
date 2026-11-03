import { expect, test } from '@playwright/test';

test('enamel group list fits desktop and mobile with a scrolling list', async ({ page }, info) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
  await page.goto('/login');
  await page.waitForFunction(() =>
    (window as any).ng?.getComponent?.(document.querySelector('app-root')),
  );
  await page.evaluate(() => {
    const ng = (window as any).ng;
    const app = ng.getComponent(document.querySelector('app-root'));
    app.session.set({ access_token: 'fixture' });
    app.currentUser.set({ id: 'self', nick: 'Анна', email: 'self@example.test' });
    app.currentUserAvatarUrl = () => null;
    app.workspaceMode.set('groups');
    app.mobilePanel.set('servers');
    const names = [
      'Атом.Порт',
      'Атом.Порт 2',
      'CS',
      'DOTA',
      'HUNT',
      'VALHEIM',
      '123123123',
      'Классная',
      'Настолка',
      'Тестовая группа',
      'Тех.Поддержка Верен — очень длинное название группы',
      'ЦУК',
      'AGE OF WONDERS',
    ];
    app.conversationLinks = () =>
      names.map((name, i) => ({
        id: `group${i}`,
        name,
        subtitle: i === 6 ? 'Привет' : 'Сообщений пока нет',
        icon: null,
        group: true,
        pinned: i < 6,
        unread: i === 9 ? 12 : 0,
        mentions: 0,
      }));
    app.selectedServerId.set('group6');
    ng.applyChanges(app);
  });
  const panel = page.locator('.conversation-sidebar--enamel');
  for (const width of [1440, 1024, 393, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 560 : 900 });
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    if (width <= 980) {
      expect(bounds!.x).toBeGreaterThanOrEqual(8);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 8);
      expect(bounds!.height).toBeGreaterThan((width === 320 ? 560 : 900) - 100);
    }
    await expect(panel.getByPlaceholder('Найти группу')).toBeVisible();
    const create = panel.getByRole('button', { name: 'Создать группу', exact: true });
    await expect(create).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await panel.locator('.conversation-sidebar__list').evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: info.outputPath(`groups-${width}.png`) });
    await create.focus();
    await panel.getByRole('button', { name: 'AGE OF WONDERS', exact: true }).focus();
    await expect(
      panel.getByRole('button', { name: 'AGE OF WONDERS', exact: true }),
    ).toBeInViewport();
    await expect(create).toBeInViewport();
  }
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--palette-canvas', '#faf8ff');
    document.documentElement.style.setProperty('--palette-text', '#231a35');
  });
  await page.screenshot({ path: info.outputPath('groups-light-short.png') });
  await panel.getByPlaceholder('Найти группу').fill('Поиск');
  await page.keyboard.press('Escape');
  await expect(panel.getByPlaceholder('Найти группу')).toHaveValue('');
});
