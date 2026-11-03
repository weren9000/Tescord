import { expect, test } from '@playwright/test';

test('painted navigation and release label on desktop and mobile', async ({ page }, info) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/release', (route) =>
    route.fulfill({ json: { revision: '744ec57c6165d77c271331c71f5c0ca322ee3f3f' } }),
  );
  await page.goto('/login');
  await page.waitForFunction(() =>
    (window as any).ng?.getComponent?.(document.querySelector('app-root')),
  );
  await page.evaluate(() => {
    const ng = (window as any).ng;
    const app = ng.getComponent(document.querySelector('app-root'));
    app.session.set({ access_token: 'fixture' });
    app.currentUserAvatarUrl = () => '/assets/cosmic/frog-moonlight-128.webp';
    app.currentUser.set({ id: 'self', nick: 'Анна', email: 'self@example.test', is_admin: true });
    ng.applyChanges(app);
  });
  for (const width of [1440, 1024, 393, 320]) {
    await page.setViewportSize({ width, height: 800 });
    if (width > 980) {
      await expect(page.locator('.release-version')).toHaveText('r744ec57');
      await expect(page.locator('app-section-navigation img[src*="security-"]')).toBeVisible();
      await expect(page.locator('app-section-navigation img[src*="bell-"]')).toBeVisible();
      await expect(
        page.locator('app-section-navigation img[src*="enamel-navigation/search-"]'),
      ).toBeVisible();
    } else {
      const images = page.locator('.mobile-mode-footer .mobile-section-art');
      await expect(images).toHaveCount(5);
      await expect(images.first()).toHaveAttribute(
        'src',
        '/assets/enamel-navigation/menu-128.webp',
      );
      for (const image of await images.all()) {
        await expect(image).toBeVisible();
        expect(await image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(
          0,
        );
      }
      await page
        .locator('.mobile-mode-footer')
        .getByRole('button', { name: 'Группы', exact: true })
        .click();
      await expect(
        page.locator('.mobile-mode-footer').getByRole('button', { name: 'Группы', exact: true }),
      ).toHaveClass(/--active/);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.waitForTimeout(400);
    await page.screenshot({ path: info.outputPath(`navigation-${width}.png`) });
    if (width <= 980) {
      await page
        .locator('.mobile-mode-footer')
        .screenshot({ path: info.outputPath(`footer-${width}.png`) });
      await page
        .locator('.mobile-mode-footer')
        .getByRole('button', { name: 'Меню приложения' })
        .click();
      const menu = page.locator('dialog.action-menu--account');
      await expect(menu).toBeVisible();
      await expect(menu.locator('.enamel-menu-art')).toHaveCount(4);
      for (const image of await menu.locator('.enamel-menu-art').all()) {
        await expect(image).toBeVisible();
        await expect(image).toHaveJSProperty('complete', true);
        expect(await image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(
          0,
        );
      }
      await page.screenshot({ path: info.outputPath(`menu-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
  }
  // Check alpha edges against a light palette as well as the default dark surfaces.
  await page.evaluate(() => {
    document.documentElement.dataset['uiScheme'] = 'light';
    for (const [key, value] of Object.entries({
      canvas: '#faf8ff',
      surface: '#f3eefb',
      raised: '#ffffff',
      text: '#231a35',
      muted: '#655774',
      secondary: '#493858',
      border: '#d2c6df',
      selected: '#e1d4f4',
      'primary-text': '#6035a0',
      hover: '#eee5fa',
    }))
      document.documentElement.style.setProperty('--palette-' + key, value);
  });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(400);
    if (width <= 980) await expect(page.locator('.mobile-mode-footer')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`navigation-light-${width}.png`) });
  }
});
