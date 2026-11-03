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
      await expect(page.locator('.search-art')).toBeVisible();
    } else {
      const images = page.locator('.mobile-mode-footer .mobile-section-art');
      await expect(images).toHaveCount(5);
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
    }
  }
});
