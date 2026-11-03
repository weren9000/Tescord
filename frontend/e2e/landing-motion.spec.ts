import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
});

test('scene follows scroll, pauses, remembers preference and respects reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const landing = page.locator('app-landing .landing');
  const stage = page.locator('.cosmic-stage');
  const toggle = page.getByRole('button', { name: 'Анимация сцены' });
  await expect(landing).toHaveClass(/motion-running/);
  await expect(landing).toHaveClass(/motion-enhanced/);
  const initial = await stage.getAttribute('style');
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect.poll(() => stage.getAttribute('style')).not.toBe(initial);
  await expect(page.locator('.landing-hero')).toHaveCSS('position', 'sticky');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(landing).not.toHaveClass(/motion-running/);
  await expect(page.locator('.scene-company>img')).toHaveCSS('animation-play-state', 'paused');
  const paused = await stage.getAttribute('style');
  await page.mouse.move(1000, 400);
  await page.evaluate(() => window.scrollBy(0, 80));
  await expect(stage).toHaveAttribute('style', paused!);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(landing).toHaveClass(/motion-running/);
  await page.locator('.landing-footer').scrollIntoViewIfNeeded();
  await expect(landing).not.toHaveClass(/motion-running/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(landing).toHaveClass(/motion-running/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(toggle).toBeDisabled();
  await expect(landing).not.toHaveClass(/motion-enhanced/);
  await expect(landing).not.toHaveClass(/motion-running/);
  await expect(stage).not.toHaveAttribute('style');
  await expect(page.locator('.scene-company>img')).toHaveCSS('animation-name', 'none');
});

test('mobile scene does not pin and call controls are an accessible local example', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/');
  await expect(page.locator('app-landing')).toBeVisible();
  await expect(page.locator('app-landing .landing')).not.toHaveClass(/motion-enhanced/);
  await expect(page.locator('.landing-hero')).not.toHaveCSS('position', 'sticky');
  await page.getByRole('button', { name: 'Микрофон в примере' }).click();
  await expect(page.locator('.call-demo-note')).toContainText('микрофон выключен');
  const camera = page.getByRole('button', { name: 'Камера в примере' });
  await camera.focus();
  await page.keyboard.press('Space');
  await expect(camera).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.call-illustration')).toHaveClass(/demo-camera/);
  await page.getByRole('button', { name: 'Экран в примере' }).click();
  await expect(page.locator('.demo-screen-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Экран в примере' }).click();
  await expect(page.locator('.demo-screen-preview')).toBeHidden();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('decorative asset failure keeps registration, downloads and readable content', async ({
  page,
}) => {
  await page.route('**/assets/cosmic-motion/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Все свои');
  await expect(page.getByRole('link', { name: 'Зарегистрироваться', exact: true })).toBeVisible();
  await expect(page.locator('.landing-downloads a')).toHaveCount(2);
  await page.getByRole('link', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
