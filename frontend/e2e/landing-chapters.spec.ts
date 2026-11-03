import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
});

for (const width of [320, 393, 1440]) {
  test(`chapters switch, rearrange and keep functional examples at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('app-landing')).toBeVisible();
    await expect(page.locator('.landing-masthead .frog-wordmark')).toContainText('Квачат');
    const display = page.locator('.space-display');
    await display.scrollIntoViewIfNeeded();
    const size = await display.boundingBox();
    await page.locator('.space-switches button').nth(1).click();
    await expect(page.locator('#space-group')).toBeVisible();
    await expect(page.locator('#space-room')).toBeHidden();
    expect((await display.boundingBox())!.height).toBeCloseTo(size!.height, 0);
    await page.locator('.space-switches button').nth(2).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#space-platform')).toBeVisible();
    if (width < 600) await expect(page.locator('.space-description')).toContainText('Сообщество');
    await display.screenshot({ path: testInfo.outputPath('platform.png') });
    const call = page.locator('.call-illustration');
    await call.scrollIntoViewIfNeeded();
    const before = await call.boundingBox();
    await page.getByRole('button', { name: 'Экран в примере' }).click();
    await expect(page.locator('.demo-screen-preview')).toBeVisible();
    const after = await call.boundingBox();
    expect(after!.height).toBeCloseTo(before!.height, 0);
    const screen = await page.locator('.demo-screen-preview').boundingBox();
    const people = await page.locator('.call-people').boundingBox();
    expect(people!.x).toBeGreaterThan(screen!.x + screen!.width);
    await call.screenshot({ path: testInfo.outputPath('screen.png') });
    await page.getByRole('button', { name: 'Экран в примере' }).click();
    await expect(page.locator('.demo-screen-preview')).toBeHidden();
    await page.getByRole('button', { name: 'Оформить как файл', exact: true }).click();
    await expect(page.locator('.packed-file')).toBeVisible();
    await page.getByRole('button', { name: 'Открыть подготовленный документ' }).click();
    await expect(page.locator('.markdown-example')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать пример файла' }).click();
    expect((await download).suggestedFilename()).toBe('meeting.md');
    await page.getByRole('button', { name: 'Вернуть текст', exact: true }).click();
    await expect(page.locator('.draft-text')).toBeVisible();
    await page.getByRole('button', { name: 'Сакура', exact: true }).click();
    await page.getByRole('button', { name: 'Космос', exact: true }).click();
    await expect(page.locator('.appearance-chat')).toHaveAttribute('data-wallpaper', 'space');
    await page
      .locator('.appearance-chapter')
      .screenshot({ path: testInfo.outputPath('appearance.png') });
    await page.locator('.apps-chapter').scrollIntoViewIfNeeded();
    await page.evaluate(() =>
      Promise.all(
        [...document.querySelectorAll<HTMLImageElement>('.apps-chapter img')].map((img) =>
          img.decode(),
        ),
      ),
    );
    await page.locator('.apps-chapter').screenshot({ path: testInfo.outputPath('apps.png') });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  });
}

test('motion control covers lower sections and repeated switches stay usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const landing = page.locator('app-landing .landing');
  await expect(landing).toHaveClass(/motion-allowed/);
  await page.locator('.space-display').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page
        .locator('.sample-wave i')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe('voice-bars');
  await page.locator('.footer-motion').click();
  await expect(landing).not.toHaveClass(/motion-allowed/);
  await page.locator('.space-display').scrollIntoViewIfNeeded();
  await expect(page.locator('.sample-wave i').first()).toHaveCSS('animation-name', 'none');
  for (let i = 0; i < 5; i++)
    await page
      .locator('.space-switches button')
      .nth(i % 3)
      .click();
  await expect(page.locator('#space-group')).toBeVisible();
  await page.locator('.footer-motion').click();
  await expect(landing).toHaveClass(/motion-allowed/);
  await page.locator('.space-display').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page
        .locator('.sample-wave i')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe('voice-bars');
});
