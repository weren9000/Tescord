import { WorkspaceStateStore } from './workspace-state.store';
import { ConversationSummary } from '../models/conversation.models';
import { WorkspaceChannel } from '../models/workspace.models';

describe('WorkspaceStateStore', () => {
  const conversation = (id: string) => ({
    id, primary_channel_id: 'channel-' + id, unread_count: 0, mention_unread_count: 0,
    first_unread_message_id: null, first_mention_unread_message_id: null,
  } as ConversationSummary);

  it('keeps the first unread anchor and clamps counts when duplicate read events arrive', () => {
    const store = new WorkspaceStateStore();
    const other = conversation('other');
    store.conversations.set([conversation('one'), other]);
    store.bumpConversationUnreadCount('one');
    store.setConversationFirstUnreadMessageIdIfMissing('one', 'first');
    store.setConversationFirstUnreadMessageIdIfMissing('one', 'later');
    store.bumpConversationUnreadCount('one', -3);
    expect(store.conversations()[0].unread_count).toBe(0);
    expect(store.conversations()[0].first_unread_message_id).toBe('first');
    expect(store.conversations()[1]).toBe(other);
    store.setConversationFirstUnreadMessageIdByChannelId('channel-one', null);
    expect(store.conversations()[0].first_unread_message_id).toBeNull();
  });

  it('routes channel events to their conversation and keeps mention counters separate', () => {
    const store = new WorkspaceStateStore();
    store.conversations.set([conversation('one'), conversation('two')]);
    store.setConversationUnreadCountByChannelId('channel-two', 5);
    store.setConversationMentionUnreadCountByChannelId('channel-two', 2);
    store.setConversationFirstMentionUnreadMessageIdByChannelId('channel-two', 'mention');
    expect(store.conversations()[0].unread_count).toBe(0);
    expect(store.conversations()[1].unread_count).toBe(5);
    expect(store.conversations()[1].mention_unread_count).toBe(2);
    expect(store.conversations()[1].first_mention_unread_message_id).toBe('mention');
  });

  it('preserves channel anchors until explicitly marked as read', () => {
    const store = new WorkspaceStateStore();
    store.channels.set([{ id: 'channel', unread_count: 1 } as WorkspaceChannel]);
    store.setChannelFirstUnreadMessageIdIfMissing('channel', 'first');
    store.setChannelFirstUnreadMessageIdIfMissing('channel', 'second');
    store.bumpChannelUnreadCount('channel', -4);
    expect(store.channels()[0].first_unread_message_id).toBe('first');
    expect(store.channels()[0].unread_count).toBe(0);
    store.setChannelFirstUnreadMessageId('channel', null);
    expect(store.channels()[0].first_unread_message_id).toBeNull();
  });
});
