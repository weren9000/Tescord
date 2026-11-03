import { expect, test } from '@playwright/test';

// Local UI fixtures: no production accounts, no network mutations.
for (const width of [320, 393, 1440]) {
  test(`cosmic dialogs retain shared glyphs and keyboard close at ${width}`, async ({
    page,
  }, info) => {
    await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await page.waitForFunction(() =>
      (window as any).ng?.getComponent?.(document.querySelector('app-root')),
    );
    await page.evaluate(() => {
      const ng = (window as any).ng;
      const app = ng.getComponent(document.querySelector('app-root'));
      (window as any).cosmicFixture = app;
      app.session.set({ access_token: 'fixture' });
      app.currentUser.set({ id: 'self', nick: 'Проверка оформления', email: 'self@example.test' });
      ng.applyChanges(app);
    });
    for (const flag of [
      'friendRequestsModalOpen',
      'createGroupModalOpen',
      'createConversationModalOpen',
    ]) {
      await page.evaluate((flag) => {
        const app = (window as any).cosmicFixture;
        app[flag].set(true);
        (window as any).ng.applyChanges(app);
      }, flag);
      const dialog = page.locator('section.modal:visible').last();
      await expect(dialog).toBeVisible();
      const close = dialog.locator('button.kva-icon-action').first();
      await expect(close.locator('app-ui-icon svg')).toBeVisible();
      await expect(close).toHaveAccessibleName(/Закрыть/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath(`${flag}-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });
}

for (const width of [393, 1440]) {
  test(`cosmic appearance, wallet and administration at ${width}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/admin/statistics')
        return route.fulfill({
          json: {
            generated_at: '2026-11-03T00:00:00Z',
            start_date: '2026-11-03',
            end_date: '2026-11-03',
            start_at: '2026-11-03T00:00:00Z',
            end_at: '2026-11-04T00:00:00Z',
            started_at: '2026-11-03T00:00:00Z',
            hourly_started_at: null,
            visit_interval: 'hour',
            resource_interval: 'minute',
            activity_available: true,
            totals: {
              active: 2,
              guest_visits: 0,
              messages: 5,
              online: 1,
              registrations: 0,
              visits: 3,
              voice: 0,
              voice_seconds: 0,
              voice_sessions: 0,
            },
            daily: [],
            top: [],
            resources: null,
            visits_history: [],
            resource_history: [],
          },
        });
      const json = path.includes('/wallet')
        ? { coins: 12, crystals: 25, items: [], page: 1, pages: 1 }
        : path.includes('/directory') || path === '/api/inventory'
          ? { items: [], total: 0, page: 1, pages: 1 }
          : path.includes('/theme')
            ? { palette: {}, themes: [] }
            : [];
      return route.fulfill({ json });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await page.waitForFunction(() =>
      (window as any).ng?.getComponent?.(document.querySelector('app-root')),
    );
    await page.evaluate(() => {
      const ng = (window as any).ng;
      const app = ng.getComponent(document.querySelector('app-root'));
      (window as any).cosmicFixture = app;
      app.session.set({ access_token: 'fixture' });
      app.currentUser.set({
        id: 'self',
        nick: 'Проверка',
        email: 'self@example.test',
        is_admin: true,
      });
      ng.applyChanges(app);
    });
    for (const [flag, selector] of [
      ['appearanceOpen', 'app-desktop-preferences'],
      ['walletOpen', 'app-wallet-dialog'],
      ['adminDirectoryOpen', 'app-admin-directory'],
    ]) {
      await page.evaluate((flag) => {
        const app = (window as any).cosmicFixture;
        app[flag].set(true);
        (window as any).ng.applyChanges(app);
      }, flag);
      await expect(page.locator(selector).locator('h2, h3').first()).toBeVisible();
      await expect(page.locator(selector).locator('app-ui-icon').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: info.outputPath(`${flag}-${width}.png`) });
      await page.evaluate((flag) => {
        const app = (window as any).cosmicFixture;
        app[flag].set(false);
        (window as any).ng.applyChanges(app);
      }, flag);
    }
    expect(errors).toEqual([]);
  });
}
