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
    await expect(page.locator('app-landing')).toBeVisible();
    await expect(page.locator('app-landing .news-row, app-landing .islands-showcase')).toHaveCount(
      0,
    );
    const actions = await page.locator('.landing-actions').boundingBox();
    const downloads = await page.locator('.landing-downloads').boundingBox();
    expect(downloads!.width).toBeCloseTo(actions!.width, 0);
    expect(downloads!.x).toBeCloseTo(actions!.x, 0);
    await expect(page.locator('.landing-downloads')).toHaveCSS('border-top-width', '0px');
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
    await expect(page.locator('app-landing dialog')).not.toBeVisible();
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
    await page.goto('/news');
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

test('landing examples change appearance, files and open the picture with keyboard', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сакура', exact: true }).click();
  await expect(page.locator('.appearance-illustration')).toHaveAttribute('data-theme', 'sakura');
  await expect(page.locator('.appearance-chat')).toHaveCSS(
    'background-color',
    'rgb(250, 240, 243)',
  );
  await expect(page.locator('.appearance-illustration .panel-header')).toHaveCSS(
    'background-color',
    'rgb(255, 250, 251)',
  );
  await page.getByRole('button', { name: 'Космос', exact: true }).click();
  await expect(page.locator('.appearance-chat')).toHaveAttribute('data-wallpaper', 'space');
  await page.getByRole('button', { name: 'Изумруд', exact: true }).click();
  await expect(page.locator('.appearance-chat')).toHaveAttribute('data-wallpaper', 'space');
  await expect(page.locator('.bubble').first()).toHaveCSS('background-color', 'rgb(27, 52, 45)');
  await page.getByRole('button', { name: 'Без обоев', exact: true }).click();
  await expect(page.locator('.appearance-chat')).toHaveCSS('background-image', 'none');
  await page.locator('.appearance-more summary').click();
  await page.getByLabel('Размер текста', { exact: true }).fill('20');
  await expect(page.locator('.bubble p').first()).toHaveCSS('font-size', '20px');
  await page.getByLabel('Рамка аватара').uncheck();
  await expect(page.locator('.avatar-frame')).toBeHidden();
  await page.getByRole('button', { name: '.py', exact: true }).click();
  await expect(page.locator('.document-illustration pre')).toContainText(
    'from pathlib import Path',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать пример файла' }).click();
  expect((await download).suggestedFilename()).toBe('example.py');
  await page.getByRole('button', { name: '.md', exact: true }).click();
  await page.getByRole('button', { name: 'Документ', exact: true }).click();
  await expect(page.locator('.markdown-example')).toBeVisible();
  await expect(page.locator('.document-illustration pre')).toBeHidden();
  const picture = page.getByRole('button', { name: 'Рассмотреть интерфейс Квачата' });
  await picture.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(picture).toBeFocused();
});

test('news cover loads and broken images fall back to readable text', async ({
  page,
}, testInfo) => {
  await page.route('**/api/news/' + posts[0].id, (route) =>
    route.fulfill({
      json: { ...posts[0], image_url: '/assets/landing-chat.png' },
    }),
  );
  await page.goto('/news/' + posts[0].id);
  await page.locator('.article-image').scrollIntoViewIfNeeded();
  await expect(page.locator('.article-image')).toBeVisible();
  expect(
    await page
      .locator('.article-image')
      .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
  ).toBeTruthy();
  await page
    .locator('.news-article')
    .screenshot({ path: testInfo.outputPath('news-with-cover.png') });
  await page.route('**/assets/landing-chat.png', (route) => route.abort());
  await page.reload();
  await page.locator('.news-article').scrollIntoViewIfNeeded();
  await expect(page.locator('.article-image')).toHaveCount(0);
  await expect(page.locator('.news-article h1')).toHaveText(posts[0].title);
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
  await page.goto('/news');
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
