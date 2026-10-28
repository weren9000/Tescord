import { UnreadStateCollection } from './unread-state';
import { Injectable, signal } from '@angular/core';
import { ConversationSummary } from '../models/conversation.models';
import { WorkspaceChannel, WorkspaceServer } from '../models/workspace.models';

/** Directory snapshots and unread transitions shared by the sidebar and realtime events. */
@Injectable()
export class WorkspaceStateStore {
  readonly servers = signal<WorkspaceServer[]>([]);
  readonly conversations = signal<ConversationSummary[]>([]);
  readonly channels = signal<WorkspaceChannel[]>([]);
  private readonly conversationUnread = new UnreadStateCollection(
    this.conversations,
    (item) => item.id,
  );
  private readonly conversationUnreadByChannel = new UnreadStateCollection(
    this.conversations,
    (item) => item.primary_channel_id,
  );
  private readonly serverUnread = new UnreadStateCollection(this.servers, (item) => item.id);
  private readonly channelUnread = new UnreadStateCollection(this.channels, (item) => item.id);

  setConversationUnreadCount(serverId: string, unreadCount: number): void {
    this.conversationUnread.setUnreadCount(serverId, unreadCount);
  }

  setConversationMentionUnreadCount(serverId: string, mentionUnreadCount: number): void {
    this.conversationUnread.setMentionUnreadCount(serverId, mentionUnreadCount);
  }

  setConversationFirstUnreadMessageId(serverId: string, messageId: string | null): void {
    this.conversationUnread.setFirstUnreadMessageId(serverId, messageId);
  }

  setConversationFirstMentionUnreadMessageId(serverId: string, messageId: string | null): void {
    this.conversationUnread.setFirstMentionUnreadMessageId(serverId, messageId);
  }

  setConversationFirstUnreadMessageIdIfMissing(serverId: string, messageId: string): void {
    this.conversationUnread.setFirstUnreadMessageIdIfMissing(serverId, messageId);
  }

  setConversationFirstMentionUnreadMessageIdIfMissing(serverId: string, messageId: string): void {
    this.conversationUnread.setFirstMentionUnreadMessageIdIfMissing(serverId, messageId);
  }

  setConversationPushEnabled(serverId: string, pushEnabled: boolean): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              push_enabled: pushEnabled,
            }
          : conversation,
      ),
    );
  }

  setServerUnreadCount(serverId: string, unreadCount: number): void {
    this.serverUnread.setUnreadCount(serverId, unreadCount);
  }

  setServerMentionUnreadCount(serverId: string, mentionUnreadCount: number): void {
    this.serverUnread.setMentionUnreadCount(serverId, mentionUnreadCount);
  }

  setChannelUnreadCount(channelId: string, unreadCount: number): void {
    this.channelUnread.setUnreadCount(channelId, unreadCount);
  }

  setChannelMentionUnreadCount(channelId: string, mentionUnreadCount: number): void {
    this.channelUnread.setMentionUnreadCount(channelId, mentionUnreadCount);
  }

  setChannelFirstUnreadMessageId(channelId: string, messageId: string | null): void {
    this.channelUnread.setFirstUnreadMessageId(channelId, messageId);
  }

  setChannelFirstMentionUnreadMessageId(channelId: string, messageId: string | null): void {
    this.channelUnread.setFirstMentionUnreadMessageId(channelId, messageId);
  }

  setChannelFirstUnreadMessageIdIfMissing(channelId: string, messageId: string): void {
    this.channelUnread.setFirstUnreadMessageIdIfMissing(channelId, messageId);
  }

  setChannelFirstMentionUnreadMessageIdIfMissing(channelId: string, messageId: string): void {
    this.channelUnread.setFirstMentionUnreadMessageIdIfMissing(channelId, messageId);
  }

  bumpServerUnreadCount(serverId: string, delta = 1): void {
    this.serverUnread.bumpUnreadCount(serverId, delta);
  }

  bumpServerMentionUnreadCount(serverId: string, delta = 1): void {
    this.serverUnread.bumpMentionUnreadCount(serverId, delta);
  }

  bumpChannelUnreadCount(channelId: string, delta = 1): void {
    this.channelUnread.bumpUnreadCount(channelId, delta);
  }

  bumpChannelMentionUnreadCount(channelId: string, delta = 1): void {
    this.channelUnread.bumpMentionUnreadCount(channelId, delta);
  }

  setConversationUnreadCountByChannelId(channelId: string, unreadCount: number): void {
    this.conversationUnreadByChannel.setUnreadCount(channelId, unreadCount);
  }

  setConversationMentionUnreadCountByChannelId(
    channelId: string,
    mentionUnreadCount: number,
  ): void {
    this.conversationUnreadByChannel.setMentionUnreadCount(channelId, mentionUnreadCount);
  }

  setConversationFirstUnreadMessageIdByChannelId(
    channelId: string,
    messageId: string | null,
  ): void {
    this.conversationUnreadByChannel.setFirstUnreadMessageId(channelId, messageId);
  }

  setConversationFirstMentionUnreadMessageIdByChannelId(
    channelId: string,
    messageId: string | null,
  ): void {
    this.conversationUnreadByChannel.setFirstMentionUnreadMessageId(channelId, messageId);
  }

  bumpConversationUnreadCount(serverId: string, delta = 1): void {
    this.conversationUnread.bumpUnreadCount(serverId, delta);
  }

  bumpConversationMentionUnreadCount(serverId: string, delta = 1): void {
    this.conversationUnread.bumpMentionUnreadCount(serverId, delta);
  }
}
