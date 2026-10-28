const { chromium, expect } = require('../../../frontend/node_modules/@playwright/test');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:8012/plugins/game-calendar/';
const good = 'a'.repeat(64) + '.webp';
const bad = 'b'.repeat(64) + '.webp';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/images/*', route => route.request().url().endsWith(good)
      ? route.fulfill({ contentType: 'image/png', body: pixel }) : route.fulfill({ status: 404 }));
    await page.route('**/api/events', route => route.fulfill({json: {
      ready: true, updated_at: new Date().toISOString(), events: [good, bad, null].map((file, index) => ({
        id: index + 1, name: 'Тестовая игра ' + index, type: 'Полевая', status: 'Заявлена',
        region: 'Урал', start_date: null, end_date: null, description: '',
        image: file ? {url: '/plugins/game-calendar/images/' + file, kind: 'cover', source_url: 'https://vk.com/club42'} : null,
      })),
    }}));
    await page.goto(base);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      const cards = page.locator('.event');
      await expect(cards).toHaveCount(3);
      await cards.nth(0).scrollIntoViewIfNeeded();
      await expect(cards.nth(0).locator('.event-art')).toHaveClass(/has-image/);
      assert(await cards.nth(0).locator('img').evaluate(el => el.naturalWidth > 0));
      await cards.nth(1).scrollIntoViewIfNeeded();
      await expect(cards.nth(1).locator('img')).toHaveCount(0);
      await expect(cards.nth(1).locator('.art-placeholder')).toBeVisible();
      await expect(cards.nth(2).locator('img')).toHaveCount(0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await cards.nth(0).locator('.event-title').click();
      await expect(page.locator('.detail-art')).toHaveClass(/has-image/);
      await expect(page.locator('.art-credit')).toHaveAttribute('href', 'https://vk.com/club42');
      assert(await page.locator('#detail').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.keyboard.press('Escape');
      await cards.nth(2).locator('.event-title').click();
      await expect(page.locator('.detail-art')).toHaveCount(0);
      await expect(page.locator('.art-credit')).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: image load, broken image fallback, no-image cards, modal credit/reset, widths 320–1440');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
