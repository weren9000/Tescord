import { expect, test } from '@playwright/test';

for (const width of [1440, 393, 320]) {
  test(`Application connections at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    let enabled = false;
    let failSave = false;
    let failLoad = false;
    let writes = 0;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const item = () => ({
        id: 'game-calendar',
        name: 'Когда игра',
        description: 'Календарь ролевых игр и конвентов.',
        enabled,
      });
      if (path === '/api/applications/game-calendar') {
        writes++;
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (failSave) return route.fulfill({ status: 500, body: '{}' });
        enabled = route.request().postDataJSON().enabled;
        return route.fulfill({ json: item() });
      }
      if (path === '/api/applications') {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (failLoad) return route.fulfill({ status: 500, body: '{}' });
        return route.fulfill({ json: [item()] });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto(`${process.env['APPLICATIONS_UI_URL'] || 'http://127.0.0.1:4217'}/login`);
    await page.waitForFunction(() =>
      (window as any).ng?.getComponent?.(document.querySelector('app-root')),
    );
    await page.evaluate(() => {
      const ng = (window as any).ng;
      const app = ng.getComponent(document.querySelector('app-root'));
      app.session.set({ access_token: 'fixture' });
      app.currentUser.set({ id: 'self', nick: 'Test', email: 'test@example.test' });
      ng.applyChanges(app);
    });
    const open = async () => {
      await page.getByRole('button', { name: 'Меню приложения', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Меню', exact: true })
        .getByRole('button', { name: 'Приложения', exact: true })
        .click();
    };
    await open();
    const dialog = page.getByRole('dialog', { name: 'Приложения', exact: true });
    await expect(dialog.getByRole('status')).toHaveText('Загружаем приложения…');
    const catalog = dialog.getByRole('button', { name: 'Каталог', exact: true });
    const mine = dialog.getByRole('button', { name: 'Мои приложения', exact: true });
    const toggle = dialog.getByRole('switch', { name: 'Подключить Когда игра' });
    await expect(dialog.getByText('Нет подключённых приложений')).toBeVisible();
    await dialog.getByRole('button', { name: 'Открыть каталог' }).click();
    await expect(toggle).not.toBeChecked();
    await dialog.getByText('Когда игра', { exact: true }).click();
    expect(writes).toBe(0);
    await toggle.click();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    await dialog.screenshot({ path: testInfo.outputPath(`catalog-${width}.png`) });
    await mine.click();
    await expect(dialog.getByRole('switch')).toHaveCount(0);
    const launch = dialog.getByRole('button', { name: 'Открыть Когда игра' });
    await expect(launch).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath(`mine-${width}.png`) });
    await page.route('**/plugins/game-calendar/', (r) => r.fulfill({ body: 'Calendar fixture' }));
    const popupPromise = page.waitForEvent('popup');
    await launch.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/plugins\/game-calendar\/$/);
    await popup.close();
    await catalog.click();
    failSave = true;
    await toggle.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(toggle).toBeChecked();
    failSave = false;
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeDisabled();
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    await mine.click();
    await expect(launch).toHaveCount(0);
    await catalog.click();
    await toggle.click();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await open();
    await expect(launch).toBeVisible();
    await catalog.click();
    await expect(toggle).toBeChecked();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    failLoad = true;
    await open();
    await expect(dialog.getByRole('alert')).toBeVisible();
    failLoad = false;
    await dialog.getByRole('button', { name: 'Повторить' }).click();
    await expect(launch).toBeVisible();
    await catalog.click();
    await page.evaluate(() => {
      const ng = (window as any).ng;
      const component = ng.getComponent(document.querySelector('app-applications'));
      component.state.items.set(
        Array.from({ length: 20 }, (_, i) => ({
          id: `fixture-${i}`,
          name: 'Приложение с очень длинным названием для проверки переноса текста',
          description:
            'Календарь мероприятий и совместных встреч с подробным описанием приложения.',
          enabled: i % 2 === 0,
        })),
      );
      ng.applyChanges(component);
    });
    await page.setViewportSize({ width, height: 568 });
    const header = dialog.locator('header');
    const before = await header.boundingBox();
    await dialog.locator('.content').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(dialog.getByRole('switch').last()).toBeInViewport();
    expect((await header.boundingBox())!.y).toBe(before!.y);
    expect(
      await dialog.locator('.content').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await dialog.screenshot({ path: testInfo.outputPath(`long-catalog-${width}.png`) });
    await page.evaluate(() => {
      const palette = {
        surface: '#ffffff',
        raised: '#f0f2f7',
        text: '#161925',
        muted: '#50596d',
        border: '#c2c8d6',
        selected: '#eee8ff',
        'primary-text': '#5935c9',
        subtle: '#70788c',
      };
      for (const [key, value] of Object.entries(palette))
        document.documentElement.style.setProperty(`--palette-${key}`, value);
    });
    await dialog.screenshot({ path: testInfo.outputPath(`light-catalog-${width}.png`) });
    expect(errors).toEqual([]);
  });
}
