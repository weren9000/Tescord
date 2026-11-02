import { test, expect } from '@playwright/test';
import posts from './fixtures/landing-news.json';

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/news')
      return route.fulfill({ json: { items: posts, total: posts.length, page: 1, pages: 1 } });
    if (url.pathname.startsWith('/api/news/')) {
      const post = posts.find((post) => url.pathname === '/api/news/' + post.id);
      return post
        ? route.fulfill({ json: post })
        : route.fulfill({ status: 404, json: { detail: 'Not found' } });
    }
    return route.fulfill({ json: [] });
  });
});

for (const width of [320, 393, 1024, 1440]) {
  test(`landing, news and direct registration ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width < 600 ? 700 : 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('app-landing .news-row')).toHaveCount(posts.length);
    await expect(page.locator('.landing-open')).toHaveText('Зарегистрироваться');
    await expect(page.locator('app-landing a[href="/register"]')).toHaveCount(1);
    await expect(page.locator('app-landing a[href="/login"]')).toHaveCount(1);
    await expect(page.locator('.landing-downloads a')).toHaveCount(2);
    const preview = await page.locator('.landing-preview').boundingBox();
    for (const action of await page.locator('.entry-actions a').all()) {
      const bounds = await action.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y + bounds!.height).toBeLessThan(page.viewportSize()!.height);
      expect(bounds!.y + bounds!.height).toBeLessThan(preview!.y);
    }
    await expect(page.locator('app-landing dialog, app-landing input, [data-dialog]')).toHaveCount(
      0,
    );
    await expect(page.locator('app-landing')).not.toContainText('Демонстрация страницы');
    await page.evaluate(async () => {
      for (const img of document.images) img.loading = 'eager';
      await Promise.all([...document.images].map((img) => img.decode()));
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`landing-dark-${width}.png`),
      fullPage: true,
    });
    await page.screenshot({ path: testInfo.outputPath(`landing-hero-${width}.png`) });
    if (width === 1440) {
      for (const [name, selector] of Object.entries({
        spaces: '.space-grid',
        documents: '.document-illustration',
        appearance: '.appearance-section',
      })) {
        await page.locator(selector).screenshot({ path: testInfo.outputPath(`${name}.png`) });
      }
    }
    await page.evaluate(() => {
      const values = {
        canvas: '#f5f6fa',
        surface: '#ffffff',
        raised: '#edf0f7',
        selected: '#eee6ff',
        text: '#202331',
        muted: '#606575',
        secondary: '#404554',
        border: '#d5d9e5',
        'primary-text': '#6546b5',
      };
      for (const [key, value] of Object.entries(values))
        document.documentElement.style.setProperty('--palette-' + key, value);
    });
    await page.screenshot({
      path: testInfo.outputPath(`landing-light-${width}.png`),
      fullPage: true,
    });
    await page.getByRole('link', { name: new RegExp(posts[0].title) }).click();
    await expect(page.locator('h1')).toHaveText(posts[0].title);
    await expect(page.locator('.article-body')).toContainText('настольная игра с ресурсами');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`news-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: '← Все новости' }).click();
    await expect(page.locator('h1')).toHaveText('Новости Квачата');
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: 'Создать аккаунт', exact: true })
      .click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('button', { name: 'Получить код', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Получить код', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Вход', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
    await page.goto('/');
    await page.getByRole('link', { name: 'Зарегистрироваться', exact: true }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('button', { name: 'Получить код', exact: true })).toBeVisible();
    await page.goto('/');
    await page.getByRole('link', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('landing stays readable and actions stay unique without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 700 },
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Свои люди.');
    await expect(page.locator('a[href="/register"]')).toHaveCount(1);
    await expect(page.locator('a[href="/login"]')).toHaveCount(1);
    await expect(page.locator('.landing-downloads a')).toHaveCount(2);
    await expect(page.locator('body')).not.toContainText('@if');
    await expect(page.locator('app-ui-icon')).toHaveCount(0);
    for (const action of await page.locator('.entry-actions a').all()) {
      const bounds = await action.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThan(700);
    }
  } finally {
    await context.close();
  }
});

test('news cover loads and broken images fall back to readable text', async ({
  page,
}, testInfo) => {
  await page.route('**/api/news?**', (route) =>
    route.fulfill({
      json: {
        items: [{ ...posts[0], image_url: '/assets/landing-chat.png' }],
        total: 1,
        page: 1,
        pages: 1,
      },
    }),
  );
  await page.goto('/');
  await page.locator('.news-cover').scrollIntoViewIfNeeded();
  await expect(page.locator('.news-cover')).toBeVisible();
  expect(
    await page
      .locator('.news-cover')
      .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
  ).toBeTruthy();
  await page
    .locator('.landing-news')
    .screenshot({ path: testInfo.outputPath('news-with-cover.png') });
  await page.route('**/assets/landing-chat.png', (route) => route.abort());
  await page.reload();
  await page.locator('.landing-news').scrollIntoViewIfNeeded();
  await expect(page.locator('.news-cover')).toHaveCount(0);
  await expect(page.locator('.news-featured h3')).toHaveText(posts[0].title);
});

test('news loading, retry, empty and long plain text', async ({ page }) => {
  let mode = 'error';
  await page.route('**/api/news', async (route) => {
    if (mode === 'error') return route.fulfill({ status: 503, json: { detail: 'unavailable' } });
    if (mode === 'empty')
      return route.fulfill({ json: { items: [], total: 0, page: 1, pages: 1 } });
    return route.fulfill({
      json: {
        items: [{ ...posts[0], title: '<script>alert(1)</script>' + 'длинно'.repeat(23) }],
        total: 1,
        page: 1,
        pages: 1,
      },
    });
  });
  // The API includes query parameters; match these explicitly as well.
  await page.route('**/api/news?**', async (route) => {
    if (mode === 'error') return route.fulfill({ status: 503, json: {} });
    return route.fulfill({
      json: {
        items:
          mode === 'empty'
            ? []
            : [{ ...posts[0], title: '<script>alert(1)</script>' + 'длинно'.repeat(23) }],
        total: mode === 'empty' ? 0 : 1,
        page: 1,
        pages: 1,
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить новости');
  mode = 'empty';
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByText('Здесь будут новости и обновления Квачата.')).toBeVisible();
  mode = 'long';
  await page.setViewportSize({ width: 320, height: 900 });
  await page.reload();
  await expect(page.locator('.news-row h3')).toContainText('<script>');
  expect(await page.locator('.news-row script').count()).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.goto('/news/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('alert')).toContainText('Новость не найдена');
});
