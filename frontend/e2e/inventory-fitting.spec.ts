import { expect, test } from '@playwright/test';
import path from 'node:path';

for (const width of [1440, 1024, 393, 320]) {
  test(`profile fitting previews before saving at ${width}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const writes: string[] = [];
    let failFrame = width === 1440;
    const items = [
      { id: 'avatar1', catalog_id: 'frog', name: 'Лунная лягушка', kind: 'avatar', equipped: true },
      {
        id: 'avatar2',
        catalog_id: 'cat',
        name: 'Кот — хранитель вечерней компании',
        kind: 'avatar',
        equipped: false,
      },
      {
        id: 'frame1',
        catalog_id: 'amethyst',
        name: 'Неоновый поток',
        kind: 'frame',
        equipped: false,
      },
      {
        id: 'wallpaper1',
        catalog_id: 'forest',
        name: 'Своё болото · Живой свет',
        kind: 'wallpaper',
        equipped: false,
      },
      {
        id: 'theme1',
        catalog_id: 'space',
        name: 'Космическая компания',
        kind: 'theme',
        equipped: false,
      },
      { id: 'avatar3', catalog_id: 'fox', name: 'Лис', kind: 'avatar', equipped: false },
    ].map((item) => ({
      ...item,
      rarity: 'rare',
      revoked: false,
      favorite: false,
      owner: null,
      created_at: '2026-11-01T00:00:00Z',
    }));
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname;
      if (p === '/api/me')
        return route.fulfill({
          json: { id: 'self', nick: 'Проверка', email: 'self@example.test' },
        });
      if (p.startsWith('/api/inventory/assets/')) {
        return route.fulfill({
          path: path.resolve('public/assets/landing/' + p.split('/').pop() + '.webp'),
        });
      }
      if (p.startsWith('/api/avatar-presets/') || p.endsWith('/avatar'))
        return route.fulfill({ path: path.resolve('public/assets/landing/frog.webp') });
      if (p === '/api/inventory') {
        const rows = items.filter(
          (item) =>
            (!url.searchParams.get('kind') || item.kind === url.searchParams.get('kind')) &&
            (url.searchParams.get('usage') !== 'used' || item.equipped) &&
            (!url.searchParams.get('q') || item.name.includes(url.searchParams.get('q')!)),
        );
        return route.fulfill({
          json: {
            items: rows,
            total: rows.length,
            page: 1,
            pages: 1,
            categories: { avatar: 3, frame: 1, wallpaper: 1, theme: 1 },
            equipped_ids: items.filter((i) => i.equipped).map((i) => i.id),
            unread: 0,
            notifications: [],
          },
        });
      }
      if (p.match(/\/items\/.*\/(equip|unequip)$/)) {
        writes.push(p);
        if (p.includes('frame1') && failFrame) {
          failFrame = false;
          return route.fulfill({
            status: 503,
            json: { detail: 'Не удалось сохранить рамку. Повторите попытку.' },
          });
        }
        const item = items.find((i) => p.includes('/' + i.id + '/'))!;
        for (const other of items)
          if (other.kind === item.kind)
            other.equipped = other.id === item.id && p.endsWith('/equip');
        return route.fulfill({ json: {} });
      }
      if (p.includes('/wallet'))
        return route.fulfill({ json: { coins: 0, crystals: 680, items: [], page: 1, pages: 1 } });
      if (p === '/api/inventory/theme') return route.fulfill({ json: { palette: {}, themes: [] } });
      return route.fulfill({ json: [] });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await page.waitForFunction(() =>
      (window as any).ng?.getComponent?.(document.querySelector('app-root')),
    );
    await page.evaluate(() => {
      const ng = (window as any).ng;
      const app = ng.getComponent(document.querySelector('app-root'));
      app.session.set({ access_token: 'fixture' });
      app.currentUser.set({ id: 'self', nick: 'Проверка', email: 'self@example.test' });
      app.shopInitialMode.set('inventory');
      app.shopOpen.set(true);
      ng.applyChanges(app);
    });
    const inventory = page.locator('app-inventory');
    await expect(inventory.locator('.tile')).toHaveCount(6);
    await expect(inventory.locator('.fitting-primary')).toBeDisabled();
    await inventory
      .getByRole('button', { name: 'Примерить: Кот — хранитель вечерней компании', exact: true })
      .click();
    await inventory
      .locator('.fitting-categories')
      .getByRole('button', { name: 'Рамки', exact: true })
      .click();
    await expect(inventory.locator('.tile')).toHaveCount(1);
    await inventory.getByRole('button', { name: 'Примерить: Неоновый поток', exact: true }).click();
    expect(writes).toEqual([]);
    await expect(inventory.locator('.fitting-primary')).toContainText('2');
    await inventory
      .locator('.fitting-categories')
      .getByRole('button', { name: 'Все', exact: true })
      .click();
    await expect(inventory.locator('.tile')).toHaveCount(6);
    await inventory.locator('.fitting-room').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`fitting-${width}.png`),
      animations: 'disabled',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await inventory
        .locator('.inventory-catalog-layout')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await inventory.locator('.fitting-primary').click();
    if (width === 1440) {
      await expect(inventory.locator('.error').first()).toContainText('Не удалось сохранить рамку');
      await expect(inventory.locator('.fitting-primary')).toContainText('1');
      await inventory.locator('.fitting-primary').click();
      expect(writes.filter((p) => p.includes('avatar2'))).toHaveLength(1);
    }
    await expect(inventory.locator('.fitting-primary')).toBeDisabled();
    await expect(inventory.locator('.notice')).toContainText('Оформление профиля применено');
    await inventory.getByRole('button', { name: 'Примерить: Лис', exact: true }).click();
    const savedWrites = writes.length;
    await inventory.getByRole('button', { name: 'Сбросить примерку' }).click();
    expect(writes).toHaveLength(savedWrites);
    await expect(inventory.locator('.fitting-primary')).toBeDisabled();
    await inventory.getByRole('button', { name: 'Фильтры', exact: true }).click();
    await expect(page.locator('.inventory-filters')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.inventory-filters')).toBeHidden();
    await expect(page.locator('app-shop .store-shell')).toBeVisible();
    await inventory
      .getByRole('textbox', { name: 'Поиск по инвентарю' })
      .fill('Несуществующий предмет');
    await expect(inventory.locator('.tile')).toHaveCount(0);
    await expect(inventory.locator('.empty')).toContainText('Ничего не найдено');
    await page.evaluate(() => {
      for (const [key, value] of Object.entries({
        surface: '#ffffff',
        raised: '#eef0f6',
        text: '#161925',
        muted: '#50596d',
        border: '#c2c8d6',
      }))
        document.documentElement.style.setProperty(`--palette-${key}`, value);
    });
    await page.screenshot({
      path: info.outputPath(`fitting-empty-light-${width}.png`),
      animations: 'disabled',
    });
    await inventory.getByRole('textbox', { name: 'Поиск по инвентарю' }).fill('');
    await expect(inventory.locator('.tile')).toHaveCount(6);
    await inventory
      .getByRole('button', { name: 'Примерить: Своё болото · Живой свет', exact: true })
      .click();
    await inventory.locator('.fitting-primary').click();
    await expect(page.locator('app-shop')).toBeHidden();
    expect(writes).toHaveLength(savedWrites);
    expect(errors).toEqual([]);
  });
}
