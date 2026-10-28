import { signal } from '@angular/core';
import { UnreadStateCollection } from './unread-state';

interface Conversation {
  id: string;
  primary_channel_id: string;
  unread_count?: number;
  mention_unread_count?: number;
  first_unread_message_id?: string | null;
  first_mention_unread_message_id?: string | null;
}

describe('UnreadStateCollection', () => {
  const first: Conversation = {id: 'chat-a', primary_channel_id: 'channel-a', unread_count: 3};
  const second: Conversation = {id: 'chat-b', primary_channel_id: 'channel-b', unread_count: 7};

  it('updates only the target, preserving unrelated fields and objects', () => {
    const items = signal([first, second]);
    const state = new UnreadStateCollection(items, item => item.id);
    state.setMentionUnreadCount('chat-a', 2);
    expect(items()[0]).toEqual({...first, mention_unread_count: 2});
    expect(items()[1]).toBe(second);
    expect(first.mention_unread_count).toBeUndefined();
    state.setUnreadCount('chat-a', -5);
    expect(items()[0].unread_count).toBe(0);
    expect(items()[0].mention_unread_count).toBe(2);
  });

  it('handles missing counters, decrements and zero deltas', () => {
    const items = signal<Conversation[]>([{id: 'chat-a', primary_channel_id: 'channel-a'}]);
    const state = new UnreadStateCollection(items, item => item.id);
    state.bumpUnreadCount('chat-a');
    state.bumpMentionUnreadCount('chat-a', 2);
    expect(items()[0].unread_count).toBe(1);
    expect(items()[0].mention_unread_count).toBe(2);
    state.bumpUnreadCount('chat-a', -10);
    state.bumpMentionUnreadCount('chat-a', -10);
    expect(items()[0].unread_count).toBe(0);
    expect(items()[0].mention_unread_count).toBe(0);
    const unchanged = items();
    state.bumpUnreadCount('chat-a', 0);
    expect(items()).toBe(unchanged);
  });

  it('preserves the first unread message until a read event clears it', () => {
    const items = signal([first]);
    const state = new UnreadStateCollection(items, item => item.id);
    state.setFirstUnreadMessageIdIfMissing('chat-a', 'message-1');
    state.setFirstUnreadMessageIdIfMissing('chat-a', 'message-2');
    state.setFirstMentionUnreadMessageIdIfMissing('chat-a', 'mention-1');
    state.setFirstMentionUnreadMessageIdIfMissing('chat-a', 'mention-2');
    expect(items()[0].first_unread_message_id).toBe('message-1');
    expect(items()[0].first_mention_unread_message_id).toBe('mention-1');
    state.setFirstUnreadMessageId('chat-a', null);
    state.setFirstMentionUnreadMessageId('chat-a', null);
    expect(items()[0].first_unread_message_id).toBeNull();
    expect(items()[0].first_mention_unread_message_id).toBeNull();
    state.setFirstUnreadMessageIdIfMissing('chat-a', 'message-3');
    expect(items()[0].first_unread_message_id).toBe('message-3');
  });

  it('shares current data between conversation and channel identities after a reload', () => {
    const items = signal([first, second]);
    const byChat = new UnreadStateCollection(items, item => item.id);
    const byChannel = new UnreadStateCollection(items, item => item.primary_channel_id);
    byChannel.setUnreadCount('channel-b', 0);
    byChannel.setFirstUnreadMessageId('channel-b', null);
    byChat.bumpUnreadCount('chat-b');
    expect(items()[1].unread_count).toBe(1);
    expect(items()[0]).toBe(first);
    items.set([{...first, unread_count: 20}]);
    byChannel.setMentionUnreadCount('channel-a', 4);
    byChat.bumpUnreadCount('chat-a');
    expect(items()[0].unread_count).toBe(21);
    expect(items()[0].mention_unread_count).toBe(4);
    byChannel.setUnreadCount('missing', 999);
    expect(items()[0].unread_count).toBe(21);
  });
});
