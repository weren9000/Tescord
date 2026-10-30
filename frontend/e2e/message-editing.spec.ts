import { expect, test, Page } from '@playwright/test';

async function setup(page: Page) {
  await page.route('**/api/**', (route) => route.fulfill({ json: [] }));
  await page.goto('/login');
  await page.waitForFunction(() =>
    (window as any).ng?.getComponent?.(document.querySelector('app-root')),
  );
  await page.evaluate(() => {
    const ng = (window as any).ng;
    const a = ng.getComponent(document.querySelector('app-root'));
    (window as any).fixture = a;
    a.session.set({ access_token: 'fixture' });
    a.currentUser.set({ id: 'self', public_id: 1, nick: 'Анна', email: 'test@example.test' });
    a.currentUserAvatarUrl = () => null;
    a.userAvatarUrl = () => null;
    a.workspaceMode.set('groups');
    a.isPlatformsMode = () => false;
    a.isGroupsMode = () => true;
    a.isChatsMode = () => false;
    a.activeServer = () => ({
      id: 'group',
      name: 'Команда проекта',
      kind: 'group_chat',
      channels: [],
    });
    a.activeChannel = () => ({ id: a.selectedChannelId(), name: 'Команда проекта', type: 'text' });
    a.activeMessagingChannel = a.activeChannel;
    a.canUseActiveChannelChat = () => true;
    a.activeGroupConversation = () => ({
      id: 'group',
      title: 'Команда проекта',
      kind: 'group_chat',
      members: [],
    });
    a.activeConversation = a.activeGroupConversation;
    a.activeGroupVoiceChannel = () => null;
    a.conversationLinks = () => [
      {
        id: 'group',
        name: 'Команда проекта',
        subtitle: 'Обсуждаем ближайшую встречу',
        group: true,
        unread: 0,
        mentions: 0,
      },
    ];
    a.selectedServerId.set('group');
    a.selectedChannelId.set('channel');
    const message = {
      id: 'message',
      channel_id: 'channel',
      type: 'text',
      content: 'Встречаемся в субботу в 18:00',
      created_at: '2026-10-30T10:00:00Z',
      edited_at: null,
      author: {
        id: 'self',
        nick: 'Анна',
        public_id: 1,
        login: 'test@example.test',
        avatar_updated_at: null,
      },
      attachments: [],
      reactions: [{ code: 'heart', count: 1, reacted: true }],
      read_by: [],
      mentioned_user_ids: [],
      reply_to: null,
    };
    a.messages.set([
      message,
      {
        ...message,
        id: 'reply',
        content: 'Хорошо, буду!',
        author: { ...message.author, id: 'other', nick: 'Михаил' },
        reply_to: { ...message, attachments_count: 0 },
      },
    ]);
    a.messageSearchResults.set([{ ...message, attachments_count: 0 }]);
    a.messagesLoading.set(false);
    a.onMessageDraftChange('Мой несохранённый черновик');
    a.pendingFiles.set([new File(['draft'], 'draft.txt', { type: 'text/plain' })]);
    a.selectedReplyMessage.set(a.messages()[1]);
    a.stopMessageAutoRefreshPolling();
    a.stopMemberPolling();
    a.stopVoicePresencePolling();
    a.schedulePresenceHeartbeat = () => {};
    ng.applyChanges(a);
  });
}

test('touch keyboard keeps Enter as a newline while editing', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 393, height: 700 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await setup(page);
    await page.evaluate(() =>
      (window as any).fixture.startMessageEdit((window as any).fixture.messages()[0]),
    );
    const field = page.getByRole('textbox', { name: 'Текст редактируемого сообщения' });
    await field.fill('Первая строка');
    await field.press('End');
    await field.press('Enter');
    await field.press('KeyA');
    await expect(field).toHaveValue('Первая строка\na');
    await expect(page.getByRole('button', { name: 'Сохранить изменения' })).toBeEnabled();
  } finally {
    await context.close();
  }
});

test('edit saves, restores draft and updates quotations without replacing reactions', async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.route('**/api/messages/message', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.expected_edited_at).toBeNull();
    const message = await page.evaluate(() => (window as any).fixture.messages()[0]);
    await route.fulfill({
      json: { ...message, content: body.content, edited_at: '2026-10-30T11:00:00Z' },
    });
  });
  await page.locator('[data-message-id="message"]').click({ button: 'right' });
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('menu-desktop.png') });
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Текст редактируемого сообщения' });
  await expect(field).toHaveValue('Встречаемся в субботу в 18:00');
  await expect(page.getByRole('button', { name: 'Сохранить изменения' })).toBeDisabled();
  await field.fill('Встречаемся в воскресенье в 19:00 🐸');
  for (const width of [1440, 1024, 393, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        const root = document.documentElement;
        const palette: Record<string, string> = {
          canvas: '#eef2f7',
          surface: '#ffffff',
          raised: '#f7f9fc',
          hover: '#e4ebf5',
          border: '#c4cfdf',
          text: '#17243a',
          subtle: '#60728d',
          muted: '#50627c',
          secondary: '#344862',
          primary: '#255fce',
          cyan: '#087487',
          selected: '#dbe8ff',
          'primary-text': '#214fa5',
          'primary-hover': '#1b4fae',
        };
        root.dataset['uiScheme'] = theme;
        root.dataset['uiTheme'] = `theme-${theme}`;
        root.style.colorScheme = theme;
        for (const [key, value] of Object.entries(palette)) {
          if (theme === 'light') {
            root.style.setProperty('--palette-' + key, value);
            root.style.setProperty(
              '--rgb-' + key,
              [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).join(' '),
            );
          } else {
            root.style.removeProperty('--palette-' + key);
            root.style.removeProperty('--rgb-' + key);
          }
        }
      }, theme);
      await expect(field).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`editing-${width}-${theme}.png`) });
    }
  }
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.locator('.composer textarea')).toHaveValue('Мой несохранённый черновик');
  await expect(page.locator('[data-message-id="message"]')).toContainText('изменено');
  expect(
    await page.evaluate(() => {
      const a = (window as any).fixture;
      return {
        text: a.messages()[1].reply_to.content,
        files: a.pendingFiles().length,
        reaction: a.messages()[0].reactions[0].reacted,
        reply: a.selectedReplyMessage().id,
        search: a.messageSearchResults()[0].content,
      };
    }),
  ).toEqual({
    text: 'Встречаемся в воскресенье в 19:00 🐸',
    files: 1,
    reaction: true,
    reply: 'reply',
    search: 'Встречаемся в воскресенье в 19:00 🐸',
  });
});

test('network errors, conflicts, Escape and navigation preserve entered text', async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.evaluate(() =>
    (window as any).fixture.startMessageEdit((window as any).fixture.messages()[0]),
  );
  const field = page.getByRole('textbox', { name: 'Текст редактируемого сообщения' });
  await field.fill('Моя правка');
  await page.route('**/api/messages/message', (route) =>
    route.fulfill({ status: 503, json: { detail: 'Нет соединения. Повторите попытку.' } }),
  );
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.getByRole('alert')).toContainText('Нет соединения');
  await expect(field).toHaveValue('Моя правка');
  await page.evaluate(() => {
    const a = (window as any).fixture;
    a.selectedChannelId.set('second');
    a.rememberChannelVisit('second');
    a.onMessageDraftChange('Другой чат');
    a.selectedChannelId.set('channel');
    a.rememberChannelVisit('channel');
  });
  await expect(field).toHaveValue('Моя правка');
  await page.route('**/api/messages/message', async (route) => {
    const message = await page.evaluate(() => (window as any).fixture.messages()[0]);
    await route.fulfill({
      status: 409,
      json: {
        detail: {
          current: { ...message, content: 'Правка с телефона', edited_at: '2026-10-30T12:00:00Z' },
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.locator('.composer__edit-conflict')).toContainText('Правка с телефона');
  await expect(field).toHaveValue('Моя правка');
  await page.screenshot({ path: testInfo.outputPath('conflict.png') });
  await field.press('Enter');
  await expect(page.locator('.composer__edit-conflict')).toBeVisible();
  await page.route('**/api/messages/message', async (route) => {
    expect(route.request().postDataJSON().expected_edited_at).toBe('2026-10-30T12:00:00Z');
    const message = await page.evaluate(() => (window as any).fixture.messages()[0]);
    await route.fulfill({
      json: { ...message, content: 'Моя правка', edited_at: '2026-10-30T13:00:00Z' },
    });
  });
  await page.getByRole('button', { name: 'Заменить актуальный текст моей правкой' }).click();
  await expect(page.locator('.composer textarea')).toHaveValue('Мой несохранённый черновик');
  await page.evaluate(() =>
    (window as any).fixture.startMessageEdit((window as any).fixture.messages()[0]),
  );
  await field.fill('Отменяемая правка');
  await field.press('Escape');
  await expect(page.locator('.composer textarea')).toHaveValue('Мой несохранённый черновик');
  await page.locator('[data-message-id="reply"]').click({ button: 'right' });
  await expect(page.getByRole('button', { name: 'Редактировать', exact: true })).toHaveCount(0);
});

test('incoming update preserves local draft, read state and reactions', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const a = (window as any).fixture;
    a.startMessageEdit(a.messages()[0]);
    a.onMessageDraftChange('Несохранённая локальная версия');
    await a.handleAppEvent({
      type: 'message_updated',
      server_id: 'group',
      message: {
        id: 'message',
        channel_id: 'channel',
        content: 'Правка собеседника',
        edited_at: '2026-10-30T12:00:00Z',
        deleted_at: null,
        mentioned_user_ids: [],
      },
    });
  });
  await expect(page.getByRole('textbox', { name: 'Текст редактируемого сообщения' })).toHaveValue(
    'Несохранённая локальная версия',
  );
  await expect(page.locator('[data-message-id="message"]')).toContainText('Правка собеседника');
  expect(
    await page.evaluate(() => (window as any).fixture.messages()[0].reactions[0].reacted),
  ).toBe(true);
});

test('a save completing in another chat restores the original attachments on return', async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/messages/message', async (route) => {
    const message = await page.evaluate(() => (window as any).fixture.messages()[0]);
    await pending;
    await route.fulfill({
      json: { ...message, content: 'Сохранено в фоне', edited_at: '2026-10-30T12:00:00Z' },
    });
  });
  await page.evaluate(() =>
    (window as any).fixture.startMessageEdit((window as any).fixture.messages()[0]),
  );
  await page
    .getByRole('textbox', { name: 'Текст редактируемого сообщения' })
    .fill('Сохранено в фоне');
  const request = page.waitForRequest('**/api/messages/message');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await request;
  await page.evaluate(() => {
    const a = (window as any).fixture;
    a.selectedChannelId.set('second');
    a.rememberChannelVisit('second');
    a.onMessageDraftChange('Второй чат');
  });
  const response = page.waitForResponse('**/api/messages/message');
  release();
  await response;
  await expect(page.locator('.composer textarea')).toHaveValue('Второй чат');
  await page.waitForFunction(
    () => (window as any).fixture.messages()[0].content === 'Сохранено в фоне',
  );
  await page.evaluate(() => {
    const a = (window as any).fixture;
    a.selectedChannelId.set('channel');
    a.rememberChannelVisit('channel');
  });
  await expect(page.locator('.composer textarea')).toHaveValue('Мой несохранённый черновик');
  expect(await page.evaluate(() => (window as any).fixture.pendingFiles()[0].name)).toBe(
    'draft.txt',
  );
});

test('meeting chat edits and cancels without losing its draft', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));
  await page.goto('/my-room');
  await page.waitForFunction(() =>
    (window as any).ng?.getComponent?.(document.querySelector('app-root')),
  );
  await page.evaluate(() => {
    const ng = (window as any).ng;
    const a = ng.getComponent(document.querySelector('app-root'));
    (window as any).roomFixture = a;
    a.ticket.set({
      token: 'fixture',
      participant_id: 'self',
      session_id: 'fixture',
      is_owner: true,
    });
    a.connected.set(true);
    a.state.set({
      name: 'Моя комната',
      participants: [{ id: 'self', name: 'Анна', is_owner: true, silenced: false }],
      remaining_uses: 49,
      owner_deadline: null,
    });
    a.messages.set([
      {
        id: 'message',
        author_id: 'self',
        author: 'Анна',
        content: 'Текст встречи',
        created_at: '2026-10-30T12:00:00Z',
        edited_at: null,
        uploads: [],
        reactions: [],
        reply_to_id: null,
      },
    ]);
    a.panel.set('chat');
    a.text = 'Черновик встречи';
    a.error.set('');
    ng.applyChanges(a);
  });
  await page.locator('.message-menu summary').first().click();
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => ({
      text: (window as any).roomFixture.text,
      editing: (window as any).roomFixture.editing?.id,
    })),
  ).toEqual({ text: 'Текст встречи', editing: 'message' });
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Текст встречи',
  );
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Сообщение', exact: true })
    .fill('Обновлённый текст встречи');
  for (const width of [1440, 393, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: testInfo.outputPath(`meeting-edit-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).press('Escape');
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Черновик встречи',
  );
  await page.route('**/api/rooms/messages/message', (route) => {
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().postDataJSON()).toEqual({
      content: 'Правка встречи',
      expected_edited_at: null,
    });
    return route.fulfill({ json: { ok: true } });
  });
  await page.evaluate(() => {
    (window as any).roomFixture.refresh = async () => {};
  });
  await page.locator('.message-menu summary').first().click();
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('Правка встречи');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Сообщение', exact: true })).toHaveValue(
    'Черновик встречи',
  );
  expect(errors).toEqual([]);
});
