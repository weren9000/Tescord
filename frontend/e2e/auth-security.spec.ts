import { expect, test } from '@playwright/test';

for (const width of [320, 393, 1024, 1440]) {
  test(`email and second factor forms at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/email/start')
        return route.fulfill({
          json: { challenge_token: 'email-fixture', expires_in: 600, resend_after: 60 },
        });
      if (path === '/api/auth/email/verify')
        return route.fulfill({
          json: {
            registration_token: 'grant-fixture',
            email: 'long-email-for-layout-check@example.test',
          },
        });
      if (path === '/api/auth/login')
        return route.fulfill({
          json: { status: 'two_factor_required', challenge_token: 'totp-fixture', expires_in: 300 },
        });
      if (path === '/api/auth/login/verify')
        return route.fulfill({
          status: 400,
          json: { detail: 'Неверный или уже использованный код.' },
        });
      return route.fulfill({ json: [] });
    });
    await page.goto('/login');
    await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Получить код', exact: true })).toBeVisible();
    await page
      .getByLabel('Email', { exact: true })
      .fill('long-email-for-layout-check@example.test');
    await page.getByRole('button', { name: 'Получить код', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Проверьте почту' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Отправить снова через/ })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath(`email-${width}.png`), fullPage: true });
    await page.getByLabel('Код из письма').fill('123456');
    await page.getByRole('button', { name: 'Подтвердить почту', exact: true }).click();
    await expect(page.getByLabel('Ник', { exact: true })).toBeVisible();
    await expect(page.getByText('Почта подтверждена:', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Вход', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill('test@example.test');
    await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Подтвердите вход' })).toBeVisible();
    await page.getByLabel('Код из приложения', { exact: true }).fill('123456');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Неверный');
    await page.getByRole('button', { name: 'Использовать резервный код' }).click();
    await expect(page.getByLabel('Резервный код', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
  });
}

for (const theme of ['dark', 'light']) {
  for (const width of [320, 393, 1024]) {
    test(`profile security ${theme} ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      let enabled = false;
      await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/inventory/theme')
          return route.fulfill({
            json: {
              id: theme,
              scheme: theme,
              palette:
                theme === 'light'
                  ? {
                      canvas: '#f5f6fa',
                      surface: '#ffffff',
                      raised: '#f1f2f7',
                      hover: '#e8eaf2',
                      text: '#202331',
                      muted: '#606575',
                      secondary: '#404554',
                      border: '#d5d9e5',
                      primary: '#7951ec',
                      'danger-text': '#b02030',
                    }
                  : {},
            },
          });
        if (path === '/api/auth/security')
          return route.fulfill({
            json: {
              email_verified: true,
              two_factor_enabled: enabled,
              setup_available: true,
              recovery_codes_remaining: enabled ? 10 : 0,
            },
          });
        if (path === '/api/auth/totp/setup')
          return route.fulfill({
            json: {
              challenge_token: 'setup-fixture',
              secret: 'LAYOUT-FIXTURE-NOT-A-REAL-KEY',
              qr_data_url:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
              expires_in: 600,
            },
          });
        if (path === '/api/auth/totp/confirm') {
          enabled = true;
          return route.fulfill({
            json: {
              recovery_codes: Array.from({ length: 10 }, (_, i) => `EXAMPLE-${i}-NOT-REAL-CODE`),
            },
          });
        }
        return route.fulfill({ json: [] });
      });
      await page.goto('/login');
      await page.waitForFunction(() =>
        (window as any).ng?.getComponent?.(document.querySelector('app-root')),
      );
      await page.evaluate((theme) => {
        const ng = (window as any).ng;
        const app = ng.getComponent(document.querySelector('app-root'));
        app.session.set({ access_token: 'fixture', user: { id: 'self' } });
        app.currentUser.set({
          id: 'self',
          nick: 'Проверка безопасности',
          email: 'long-email-for-layout@example.test',
          public_id: 123456,
        });
        app.profileEditorOpen.set(true);
        ng.applyChanges(app);
      }, theme);
      await page.waitForFunction(
        (theme) => document.documentElement.dataset['uiScheme'] === theme,
        theme,
      );
      const panel = page.getByRole('region', { name: 'Безопасность аккаунта' });
      await page.getByRole('button', { name: 'Безопасность аккаунта', exact: true }).click();
      await expect(panel.getByText('Подтверждена', { exact: true })).toBeVisible();
      await panel.getByRole('button', { name: 'Настроить 2FA' }).click();
      await panel.getByLabel('Текущий пароль').fill('fixture-password');
      await panel.getByRole('button', { name: 'Продолжить' }).click();
      await expect(panel.getByLabel('Ключ для ручного ввода', { exact: true })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`setup-${theme}-${width}.png`),
        mask: [page.locator('[data-private]')],
        fullPage: true,
      });
      await panel.getByLabel('Код из приложения', { exact: true }).fill('123456');
      await panel.getByRole('button', { name: 'Включить 2FA' }).click();
      await expect(panel.getByRole('button', { name: 'Скачать коды' })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`recovery-${theme}-${width}.png`),
        mask: [page.locator('[data-private]')],
        fullPage: true,
      });
      await panel.getByRole('button', { name: 'Я сохранил коды' }).click();
      await expect(panel.getByText('Включена', { exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBeTruthy();
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('dialog', { name: 'Мой профиль', exact: true }),
      ).not.toBeVisible();
    });
  }
}
