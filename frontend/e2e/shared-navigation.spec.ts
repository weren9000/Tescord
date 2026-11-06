import { expect, test } from '@playwright/test';

for (const section of ['groups', 'chats'] as const) {
  test(`${section}: thin handle and independent navigation state`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/**', (r) => r.fulfill({ json: [] }));
    const setup = async () => {
      await page.goto(`${process.env['PLATFORM_UI_URL'] || 'http://127.0.0.1:4217'}/login`);
      await page.waitForFunction(() =>
        (window as any).ng?.getComponent?.(document.querySelector('app-root')),
      );
      await page.evaluate((section) => {
        const ng = (window as any).ng;
        const a = ng.getComponent(document.querySelector('app-root'));
        (window as any).fixture = a;
        a.session.set({ access_token: 'fixture' });
        a.currentUser.set({ id: 'self', nick: 'Test', email: 'test@example.test' });
        a.currentUserAvatarUrl = () => null;
        a.workspaceMode.set(section);
        a.isPlatformsMode = () => false;
        a.isGroupsMode = () => section === 'groups';
        a.isChatsMode = () => section === 'chats';
        const names =
          section === 'groups'
            ? ['Поход выходного дня', 'Настольные игры', 'Команда проекта']
            : ['Анна', 'Михаил', 'Екатерина'];
        a.conversationLinks = () =>
          Array.from({ length: 24 }, (_, i) => ({
            id: `chat${i}`,
            name: names[i % names.length] + (i > 2 ? ` ${i}` : ''),
            subtitle: section === 'groups' ? 'Групповой чат' : 'В сети',
            icon: null,
            group: section === 'groups',
            online: true,
            unread: i === 0 ? 120 : 0,
            mentions: 0,
          }));
        a.selectedServerId.set('chat0');
        a.activeServer = () => ({ id: 'chat0', name: names[0], channels: [] });
        a.activeChannel = () => ({ id: 'text', name: names[0], type: 'text' });
        a.activeGroupConversation = () =>
          section === 'groups'
            ? { id: 'chat0', title: names[0], kind: 'group_chat', members: [] }
            : null;
        a.activeGroupVoiceChannel = () =>
          section === 'groups' ? { id: 'voice', name: 'Созвон', type: 'voice' } : null;
        ng.applyChanges(a);
      }, section);
    };
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup();
    const hide = page.getByRole('button', { name: 'Скрыть навигацию', exact: true });
    const show = page.getByRole('button', { name: 'Показать навигацию', exact: true });
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const searchIcon = (await page.locator('.section-search app-ui-icon').boundingBox())!;
      expect(searchIcon.width).toBe(20);
      expect(searchIcon.height).toBe(20);
      const field = page.locator('.composer textarea');
      await field.focus();
      await page.mouse.move(width - 40, 300);
      await expect(hide).toHaveCSS('opacity', '0');
      await page.locator('.conversation-sidebar').hover();
      await hide.hover();
      await expect(hide).toHaveCSS('opacity', '1');
      const handle = await hide.locator('.navigation-handle').boundingBox();
      expect(handle!.width).toBe(22);
      expect(handle!.height).toBe(36);
      const heads = await Promise.all(
        ['.desktop-sidebar-toolbar', '.conversation-head'].map((s) =>
          page.locator(s).boundingBox(),
        ),
      );
      expect(heads[0]!.height).toBe(64);
      expect(heads[1]!.height).toBe(62);
      expect(heads[0]!.y).toBe(heads[1]!.y - 1);
      await page.screenshot({ path: testInfo.outputPath(`${section}-expanded-${width}.png`) });
      await page.getByRole('button', { name: 'Свернуть список бесед', exact: true }).click();
      const panel = page.locator('.conversation-sidebar--enamel');
      const expand = page.getByRole('button', { name: 'Развернуть список бесед', exact: true });
      await expect(panel).toHaveCSS('width', '74px');
      const panelBox = (await panel.boundingBox())!;
      const expandBox = (await expand.boundingBox())!;
      const center = panelBox.x + panelBox.width / 2;
      expect(Math.abs(expandBox.x + expandBox.width / 2 - center)).toBeLessThan(1);
      for (const selector of ['.entry', '.avatar', 'small', '.presence']) {
        for (const item of await panel.locator(selector).all()) {
          const box = (await item.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(panelBox.x + 3);
          expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width - 3);
          if (selector === '.avatar')
            expect(Math.abs(box.x + box.width / 2 - center)).toBeLessThan(1);
        }
      }
      const scroll = panel.locator('.conversation-sidebar__list');
      expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${section}-collapsed-${width}.png`),
        animations: 'disabled',
      });
      await panel.locator('.entry').last().focus();
      await expect(panel.locator('.entry').last()).toBeInViewport();
      await expand.click();
      await expect(panel.getByRole('searchbox')).toBeVisible();
      await field.fill('Черновик\nВторая строка');
      await page.evaluate(() => {
        (window as any).chatNode = document.querySelector('.messenger-workspace');
      });
      await hide.focus();
      await page.keyboard.press('Enter');
      await expect(show).toBeFocused();
      await expect(page.locator('app-section-navigation')).toBeHidden();
      await expect(page.locator('.conversation-sidebar')).toBeHidden();
      const restored = await show.locator('.navigation-handle').boundingBox();
      expect(restored!.x).toBeLessThan(2);
      expect(Math.abs(restored!.y + restored!.height / 2 - 450)).toBeLessThan(2);
      await expect(field).toHaveValue('Черновик\nВторая строка');
      expect(
        await page.evaluate(
          () => (window as any).chatNode === document.querySelector('.messenger-workspace'),
        ),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${section}-hidden-${width}.png`) });
      await show.click();
      await expect(hide).toBeFocused();
      await field.fill('');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await hide.click();
    await setup();
    await expect(show).toBeVisible();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('kva.desktop-layout.v1')!),
    );
    expect(saved[section === 'groups' ? 'groupNavigationHidden' : 'friendNavigationHidden']).toBe(
      true,
    );
    expect(saved[section === 'groups' ? 'friendNavigationHidden' : 'groupNavigationHidden']).toBe(
      false,
    );
    expect(saved.platformNavigationHidden).toBe(false);
    await page.evaluate(() => {
      const a = (window as any).fixture;
      a.workspaceMode.set(a.workspaceMode() === 'groups' ? 'chats' : 'groups');
      (window as any).ng.applyChanges(a);
    });
    await expect(show).toBeHidden();
    await expect(page.locator('.conversation-sidebar')).toBeVisible();
    await page.evaluate((section) => {
      const a = (window as any).fixture;
      a.workspaceMode.set(section);
      a.desktopPreferences.update({
        groupNavigationHidden: false,
        friendNavigationHidden: false,
        width: 360,
      });
      a.conversationInfoOpen.set(true);
      a.activeServer = () => ({
        id: 'chat0',
        name: 'Очень длинное название беседы для проверки выравнивания шапки',
        channels: [],
      });
      (window as any).ng.applyChanges(a);
    }, section);
    await page.locator('.conversation-sidebar').hover();
    await hide.click();
    await expect(show).toBeVisible();
    expect((await page.locator('.messenger-workspace').boundingBox())!.width).toBeGreaterThan(600);
    await show.click();
    await page.evaluate(() => {
      const a = (window as any).fixture;
      a.conversationInfoOpen.set(false);
      a.conversationLinks = () => [];
      (window as any).ng.applyChanges(a);
      const palette = {
        surface: '#ffffff',
        canvas: '#f5f6fa',
        raised: '#eef0f6',
        text: '#161925',
        muted: '#50596d',
        secondary: '#50596d',
        subtle: '#657088',
        border: '#c2c8d6',
        selected: '#eee8ff',
        hover: '#e6e7f0',
        'primary-text': '#5935c9',
      };
      for (const [key, value] of Object.entries(palette)) {
        document.documentElement.style.setProperty(`--palette-${key}`, value);
        document.documentElement.style.setProperty(
          `--rgb-${key}`,
          [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).join(' '),
        );
      }
    });
    await page.screenshot({ path: testInfo.outputPath(`${section}-light-empty.png`) });
    await page.locator('.conversation-sidebar').hover();
    await hide.click();
    await show.click();
    for (const width of [393, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(() => {
        const a = (window as any).fixture;
        a.mobilePanel.set(null);
        (window as any).ng.applyChanges(a);
      });
      const header = page.locator('.conversation-header-block');
      await expect(header).toBeInViewport({ ratio: 1 });
      if (section === 'groups') {
        await expect(header.locator('.group-voice-card')).toHaveCount(1);
        for (const button of await header.locator('.group-voice-card__action').all()) {
          await expect(button).toBeInViewport({ ratio: 1 });
        }
      }
      await page.screenshot({
        path: testInfo.outputPath(`${section}-header-${width}.png`),
        animations: 'disabled',
      });
      await page.evaluate(() => {
        const a = (window as any).fixture;
        a.mobilePanel.set('servers');
        (window as any).ng.applyChanges(a);
      });
      await expect(page.locator('.conversation-sidebar')).toBeVisible();
      await expect(show).toBeHidden();
      await expect(hide).toBeHidden();
      await page.screenshot({
        path: testInfo.outputPath(`${section}-mobile-${width}.png`),
        animations: 'disabled',
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    expect(errors).toEqual([]);
  });
}
