import { expect, test } from '@playwright/test';

for (const width of [1440, 1024, 393, 320]) {
  test(`Islands embedded launch and scoped authorization at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(45000);
    await page.setViewportSize({ width, height: 900 });
    let grants = 0;
    let failGrant = true;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/applications')
        return route.fulfill({
          json: [
            {
              id: 'islands',
              name: 'Острова',
              description: 'Настольная стратегия для друзей.',
              enabled: true,
            },
          ],
        });
      if (path === '/api/applications/islands/grant') {
        grants++;
        expect(route.request().headers()['authorization']).toBe('Bearer main-fixture-session');
        if (failGrant) return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
        return route.fulfill({ json: { grant: 'scoped-game-grant-fixture' } });
      }
      return route.fulfill({ json: [] });
    });
    await page.route('**/plugins/islands/play.html', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>Игровой экран</h1><p id="result">Ждём разрешение</p><script src="bridge-fixture.js"></script></body></html>',
      }),
    );
    await page.route('**/plugins/islands/bridge-fixture.js', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.addEventListener('message', e => { if (e.source !== parent || e.origin !== location.origin) return; if (e.data?.type === 'islands:hello') parent.postMessage({type:'islands:ready'}, location.origin); if (e.data?.type === 'islands:grant') document.querySelector('#result').textContent = e.data.grant; }); parent.postMessage({type:'islands:ready'}, location.origin);`,
      }),
    );
    await page.goto('/login');
    await page.waitForFunction(() =>
      (window as any).ng?.getComponent?.(document.querySelector('app-root')),
    );
    await page.evaluate((width) => {
      const ng = (window as any).ng;
      const app = ng.getComponent(document.querySelector('app-root'));
      app.session.set({ access_token: 'main-fixture-session' });
      app.currentUser.set({ id: 'self', nick: 'Test', email: 'test@example.test' });
      app.activeCallSurface = () => ({
        kind: 'group',
        id: 'group:voice',
        title: 'Созвон друзей',
        subtitle: 'Группа',
        channelId: 'voice',
        participantCount: 2,
      });
      app.voiceRoom.state.set('connected');
      app.callWindowMode.set(width > 980 ? 'expanded' : 'minimized');
      (window as any).islandsCallFixture = app.voiceRoom;
      ng.applyChanges(app);
    }, width);
    await page.getByRole('button', { name: 'Меню приложения', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Меню', exact: true })
      .getByRole('button', { name: 'Приложения', exact: true })
      .click();
    await page.getByRole('button', { name: 'Открыть Острова', exact: true }).click();
    const app = page.locator('app-islands');
    await expect(app).toBeVisible();
    await expect(page.getByRole('region', { name: 'Текущий звонок' })).toBeVisible();
    await expect(
      page.locator('.call-tray').getByRole('button', { name: 'Завершить звонок', exact: true }),
    ).toBeVisible();
    await expect(app.getByRole('alert')).toBeVisible();
    failGrant = false;
    await app.getByRole('button', { name: 'Повторить вход' }).click();
    const frame = page.frameLocator('app-islands iframe');
    await expect(frame.locator('#result')).toHaveText('scoped-game-grant-fixture');
    expect(await app.locator('iframe').getAttribute('src')).not.toContain('token');
    expect(await frame.locator('body').textContent()).not.toContain('main-fixture-session');
    const before = grants;
    await page.evaluate(() => window.postMessage({ type: 'islands:ready' }, location.origin));
    await page.waitForTimeout(300);
    expect(grants).toBe(before);
    const box = await app.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(250);
    expect(box!.height).toBeGreaterThan(300);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath(`islands-${width}.png`) });
    await app.getByRole('button', { name: 'Вернуться в Квачат' }).click();
    await expect(app).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).islandsCallFixture.state())).toBe('connected');
    await expect(page.getByRole('button', { name: 'Меню приложения', exact: true })).toBeFocused();
    expect(errors).toEqual([]);
  });
}
