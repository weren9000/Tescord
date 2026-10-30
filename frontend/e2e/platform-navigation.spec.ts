import { expect, test } from '@playwright/test';

test('Platform alignment and full navigation collapse', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }));
  const setup = async () => {
    await page.goto(`${process.env['PLATFORM_UI_URL'] || 'http://127.0.0.1:4217'}/login`);
    await page.waitForFunction(() =>
      (window as any).ng?.getComponent?.(document.querySelector('app-root')),
    );
    await page.evaluate(() => {
      const ng = (window as any).ng;
      const a = ng.getComponent(document.querySelector('app-root'));
      (window as any).fixture = a;
      a.session.set({ access_token: 'fixture' });
      a.currentUser.set({ id: 'self', nick: 'Test', email: 'test@example.test' });
      a.currentUserAvatarUrl = () => null;
      a.isPlatformsMode = () => true;
      a.isGroupsMode = () => false;
      a.isChatsMode = () => false;
      a.workspaceMode.set('platforms');
      const platform = {
        id: 'platform',
        name: 'Атом.Площадка',
        description: 'Сообщество',
        member_role: 'owner',
      };
      const chats = ['Общий', 'Техподдержка', 'Разработка', 'Болталка'].map((title, i) => ({
        id: `chat${i}`,
        title,
        kind: 'group_chat',
        platform_id: 'platform',
        primary_channel_id: 'text',
        members: [],
        member_role: 'owner',
        subtitle: 'Сообщений пока нет',
        unread_count: 0,
      }));
      a.activePlatform = () => platform;
      a.platformChoices = () => [
        { id: 'platform', name: platform.name, description: 'Чаты сообщества' },
      ];
      a.selectedPlatformId.set('platform');
      a.selectedPlatformChats = () => chats;
      a.selectedServerId.set('chat3');
      a.activeServer = () => ({ id: 'chat3', name: 'Болталка', channels: [] });
      a.activeChannel = () => ({ id: 'text', name: 'Болталка', type: 'text' });
      a.activeGroupConversation = () => chats[3];
      a.activeGroupVoiceChannel = () => ({ id: 'voice', type: 'voice', name: 'Созвон' });
      ng.applyChanges(a);
    });
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup();
  const hide = page.getByRole('button', { name: 'Скрыть навигацию', exact: true });
  const restore = page.getByRole('button', { name: 'Показать навигацию', exact: true });
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.mouse.move(width - 20, 400);
    await page.locator('.composer textarea').focus();
    await expect(hide).toHaveCSS('opacity', '0');
    await page.locator('app-platform-list').hover();
    await expect(hide).toHaveCSS('opacity', '1');
    await hide.hover();
    await expect(hide).toHaveCSS('opacity', '1');
    const headings = await Promise.all(
      ['app-platform-list header', 'app-platform-chats .panel-head', '.conversation-head'].map(
        (s) => page.locator(s).boundingBox(),
      ),
    );
    expect(
      Math.max(...headings.map((b) => b!.height)) - Math.min(...headings.map((b) => b!.height)),
    ).toBeLessThan(1);
    const searches = await Promise.all(
      ['app-platform-list .search', 'app-platform-chats .chat-tools .search'].map((s) =>
        page.locator(s).boundingBox(),
      ),
    );
    expect(Math.abs(searches[0]!.y - searches[1]!.y)).toBeLessThan(1);
    expect(Math.abs(searches[0]!.height - searches[1]!.height)).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath(`expanded-${width}.png`) });
    const composer = page.locator('.composer textarea');
    await composer.fill('Сохранённый черновик');
    const voiceTop = (await page.locator('.group-voice-card').boundingBox())!.y;
    await page.evaluate(
      () => ((window as any).originalChat = document.querySelector('.messenger-workspace')),
    );
    await hide.focus();
    await page.keyboard.press('Enter');
    await expect(restore).toBeFocused();
    await expect(page.locator('app-section-navigation')).toBeHidden();
    await expect(page.locator('app-platform-list')).toBeHidden();
    await expect(page.locator('.platform-sidebar')).toBeHidden();
    await expect(composer).toHaveValue('Сохранённый черновик');
    expect((await page.locator('.group-voice-card').boundingBox())!.y).toBe(voiceTop);
    expect(
      await page.evaluate(
        () => (window as any).originalChat === document.querySelector('.messenger-workspace'),
      ),
    ).toBe(true);
    expect((await page.locator('.messenger-workspace').boundingBox())!.width).toBeGreaterThan(
      width - 30,
    );
    await page.screenshot({ path: testInfo.outputPath(`collapsed-${width}.png`) });
    await restore.click();
    await expect(hide).toBeFocused();
    await composer.fill('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await hide.click();
  await setup();
  await expect(restore).toBeVisible();
  await restore.click();
  await page.evaluate(() => {
    const a = (window as any).fixture;
    a.desktopPreferences.update({ platformsWidth: 360, platformChatsWidth: 460 });
    a.conversationInfoOpen.set(true);
    a.activePlatform = () => ({
      id: 'platform',
      name: 'Очень длинное название площадки для проверки выравнивания',
      member_role: 'owner',
    });
    (window as any).ng.applyChanges(a);
  });
  await page.locator('.platform-sidebar').hover();
  await hide.hover();
  const sidebarEdge = await page.locator('.platform-sidebar').boundingBox();
  const control = await hide.boundingBox();
  expect(Math.abs(control!.x - (sidebarEdge!.x + sidebarEdge!.width - 16))).toBeLessThan(2);
  await hide.click();
  await expect(restore).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await restore.click();
  await page.evaluate(() => {
    const a = (window as any).fixture;
    a.conversationInfoOpen.set(false);
    a.desktopPreferences.update({ platformsCollapsed: true });
    (window as any).ng.applyChanges(a);
    const palette = {
      surface: '#ffffff',
      canvas: '#f5f6fa',
      raised: '#eef0f6',
      text: '#161925',
      muted: '#50596d',
      border: '#c2c8d6',
      selected: '#eee8ff',
      'primary-text': '#5935c9',
    };
    for (const [key, value] of Object.entries(palette))
      document.documentElement.style.setProperty(`--palette-${key}`, value);
  });
  await page.locator('.platform-sidebar').hover();
  await hide.hover();
  await page.screenshot({ path: testInfo.outputPath('light-compact-list.png') });
  await hide.click();
  await expect(restore).toBeVisible();
  await restore.click();
  for (const width of [393, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate(() => {
      const a = (window as any).fixture;
      a.desktopPreferences.update({ platformNavigationHidden: true });
      a.mobilePanel.set('servers');
      a.platformBrowserStage.set('channels');
      (window as any).ng.applyChanges(a);
    });
    await expect(page.locator('.platform-sidebar')).toBeVisible();
    await expect(restore).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`mobile-${width}.png`) });
  }
  expect(errors).toEqual([]);
});
