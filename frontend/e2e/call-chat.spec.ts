import { expect, test } from '@playwright/test';

for (const kind of ['direct', 'group', 'platform'] as const) {
  test(`${kind}: call chat stays beside the stage and preserves the composer`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${process.env['KVA_UI_BASE'] || 'http://127.0.0.1:4217'}/login`);
    await page.waitForFunction(() =>
      (window as any).ng?.getComponent?.(document.querySelector('app-root')),
    );
    await page.evaluate((kind) => {
      const ng = (window as any).ng;
      const a = ng.getComponent(document.querySelector('app-root'));
      (window as any).fixture = a;
      a.session.set({ access_token: 'fixture' });
      a.currentUser.set({ id: 'self', nick: 'Вы', email: 'self@example.test' });
      a.userAvatarUrl = () => null;
      a.currentUserAvatarUrl = () => null;
      const mode = kind === 'direct' ? 'chats' : kind === 'platform' ? 'platforms' : 'groups';
      a.workspaceMode.set(mode);
      a.selectedServerId.set('chat');
      a.selectedChannelId.set('text');
      a.activeServer = () => ({ id: 'chat', name: 'Команда проекта', kind: 'group_chat' });
      a.activeChannel = () => ({ id: 'text', name: 'Общий', type: 'text' });
      a.channels = () => [{ id: 'text', name: 'Общий', type: 'text' }];
      a.activeCallChatTarget = () => ({ serverId: 'chat', mode, channelId: 'text' });
      a.activeCallSurface = () => ({
        kind,
        id: `${kind}:voice`,
        title: 'Команда проекта',
        subtitle: 'Созвон',
        channelId: 'voice',
        participantCount: 2,
      });
      a.activeCallVoiceParticipants = () => [
        { id: 'self', user_id: 'self', nick: 'Вы', is_self: true, muted: false },
        { id: 'peer', user_id: 'peer', nick: 'Александр', is_self: false, muted: false },
      ];
      a.voiceRoom.state.set('connected');
      a.directCall.peer.set({ user_id: 'peer', nick: 'Александр', avatar_updated_at: null });
      a.directCall.state.set('connected');
      a.callWindowMode.set('expanded');
      ng.applyChanges(a);
    }, kind);
    const toggle = page.locator('.call-chat-toggle');
    const stream = page.locator('.conversation-stream');
    const stage = page.locator('.call-window-layer');
    await expect(toggle).toBeVisible();
    await expect(stream).toBeHidden();
    await page.evaluate(() => {
      (window as any).stageNode = document.querySelector('.call-window-layer');
      (window as any).composerNode = document.querySelector('.composer textarea');
    });
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(stream).toBeVisible();
      await expect(stage).toBeVisible();
      const left = (await stage.boundingBox())!;
      const right = (await stream.boundingBox())!;
      expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 1);
      expect(right.width).toBeGreaterThanOrEqual(280);
      expect(right.x + right.width).toBeLessThanOrEqual(width + 1);
      expect(left.width).toBeGreaterThan(300);
      const controls = await page.locator('.call-window__controls button').evaluateAll((buttons) =>
        buttons
          .filter((button) => button.getBoundingClientRect().width > 0)
          .map((button) => {
            const rect = button.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          }),
      );
      expect(controls.every((button) => button.left >= left.x && button.right <= right.x)).toBe(
        true,
      );
      const field = page.locator('.composer textarea');
      await field.fill('Черновик звонка\nВторая строка');
      await page.screenshot({ path: testInfo.outputPath(`${kind}-${width}.png`) });
      await page.getByRole('button', { name: 'Участники', exact: true }).click();
      await expect(stream).toBeHidden();
      await expect(page.locator('.call-window__roster')).toBeVisible();
      await toggle.click();
      await expect(page.locator('.call-window__roster')).toBeHidden();
      await expect(field).toHaveValue('Черновик звонка\nВторая строка');
      await page.keyboard.press('Escape');
      await expect(stream).toBeHidden();
      await expect(toggle).toBeFocused();
      await expect(stage).toBeVisible();
      expect(
        await page.evaluate(
          () => (window as any).stageNode === document.querySelector('.call-window-layer'),
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => (window as any).composerNode === document.querySelector('.composer textarea'),
        ),
      ).toBe(true);
    }
    // Resizing an already opened desktop panel also gives a full-width mobile chat.
    await toggle.click();
    await page.setViewportSize({ width: 393, height: 852 });
    await expect(stage).toBeHidden();
    await expect(stream).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть переписку', exact: true }).click();
    await expect(stage).toBeVisible();
    for (const width of [393, 320]) {
      await page.setViewportSize({ width, height: 852 });
      await toggle.click();
      await expect(stream).toBeVisible();
      await expect(stage).toHaveCount(0);
      await expect(page.locator('.composer textarea')).toHaveValue(
        'Черновик звонка\nВторая строка',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`${kind}-mobile-${width}.png`) });
      await page.evaluate(() => {
        (window as any).fixture.expandCallWindow();
        (window as any).ng.applyChanges((window as any).fixture);
      });
      await expect(stage).toBeVisible();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await toggle.click();
    await page.evaluate(() => {
      const a = (window as any).fixture;
      a.messages.set(
        Array.from({ length: 30 }, (_, i) => ({
          id: `message-${i}`,
          channel_id: 'text',
          type: 'text',
          content:
            i === 0 ? 'ДлиннаяСсылка'.repeat(50) : `Сообщение ${i + 1}: обсуждаем планы встречи.`,
          created_at: new Date(2026, 9, 30, 10, i).toISOString(),
          edited_at: null,
          author: { user_id: 'peer', nick: 'Александр', avatar_updated_at: null },
          reply_to: null,
          attachments: [],
          reactions: [],
          read_by: [],
          mentioned_user_ids: [],
        })),
      );
      (window as any).ng.applyChanges(a);
    });
    await expect(page.locator('.message-list .message-card').first()).toBeVisible();
    await page.locator('.message-list').evaluate((element) => {
      element.scrollTop = 180;
    });
    const scroll = await page.locator('.message-list').evaluate((element) => element.scrollTop);
    await toggle.click();
    await toggle.click();
    await expect
      .poll(() => page.locator('.message-list').evaluate((element) => element.scrollTop))
      .toBe(scroll);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (kind !== 'direct') {
      await page.evaluate(() => {
        const a = (window as any).fixture;
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#233655';
        context.fillRect(0, 0, 1280, 720);
        context.fillStyle = '#ffffff';
        context.font = '48px sans-serif';
        context.fillText('Демонстрация экрана', 60, 100);
        const media = canvas.captureStream(5);
        (window as any).fixtureMedia = media;
        a.activeCallVoiceVideoScene = () => ({
          stageTile: {
            id: 'screen',
            source: 'screen-share',
            stream: media,
            nick: 'Александр',
            isSelf: true,
          },
          secondaryTiles: [],
        });
        (window as any).ng.applyChanges(a);
      });
      const video = page.locator('.conference-presentation video');
      await expect(video).toBeVisible();
      await page.waitForFunction(
        () =>
          (document.querySelector('.conference-presentation video') as HTMLVideoElement)
            ?.readyState >= 2,
      );
      await page.evaluate(() => {
        (window as any).videoNode = document.querySelector('.conference-presentation video');
      });
      await toggle.click();
      await toggle.click();
      expect(
        await page.evaluate(
          () =>
            (window as any).videoNode === document.querySelector('.conference-presentation video'),
        ),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${kind}-screen-chat.png`) });
      await page.evaluate(() => {
        (window as any).fixtureMedia.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        (window as any).fixture.activeCallVoiceVideoScene = () => null;
        (window as any).ng.applyChanges((window as any).fixture);
      });
      await expect(video).toHaveCount(0);
    }
    await page.evaluate(() => {
      const palette: Record<string, string> = {
        canvas: '#f5f6fa',
        surface: '#ffffff',
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
    await page.screenshot({ path: testInfo.outputPath(`${kind}-light.png`) });
    expect(errors).toEqual([]);
  });
}
