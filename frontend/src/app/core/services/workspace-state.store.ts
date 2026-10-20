import { Injectable, signal } from '@angular/core';
import { ConversationSummary } from '../models/conversation.models';
import { WorkspaceChannel, WorkspaceServer } from '../models/workspace.models';

/** Directory snapshots and unread transitions shared by the sidebar and realtime events. */
@Injectable()
export class WorkspaceStateStore {
  readonly servers = signal<WorkspaceServer[]>([]);
  readonly conversations = signal<ConversationSummary[]>([]);
  readonly channels = signal<WorkspaceChannel[]>([]);

  setConversationUnreadCount(serverId: string, unreadCount: number): void {
    const normalizedUnreadCount = Math.max(0, unreadCount);
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              unread_count: normalizedUnreadCount,
            }
          : conversation
      )
    );
  }

  setConversationMentionUnreadCount(serverId: string, mentionUnreadCount: number): void {
    const normalizedMentionUnreadCount = Math.max(0, mentionUnreadCount);
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              mention_unread_count: normalizedMentionUnreadCount,
            }
          : conversation
      )
    );
  }

  setConversationFirstUnreadMessageId(serverId: string, messageId: string | null): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              first_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  setConversationFirstMentionUnreadMessageId(serverId: string, messageId: string | null): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              first_mention_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  setConversationFirstUnreadMessageIdIfMissing(serverId: string, messageId: string): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId && !conversation.first_unread_message_id
          ? {
              ...conversation,
              first_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  setConversationFirstMentionUnreadMessageIdIfMissing(serverId: string, messageId: string): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId && !conversation.first_mention_unread_message_id
          ? {
              ...conversation,
              first_mention_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  setConversationPushEnabled(serverId: string, pushEnabled: boolean): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              push_enabled: pushEnabled,
            }
          : conversation
      )
    );
  }

  setServerUnreadCount(serverId: string, unreadCount: number): void {
    const normalizedUnreadCount = Math.max(0, unreadCount);
    this.servers.update((servers) =>
      servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              unread_count: normalizedUnreadCount,
            }
          : server
      )
    );
  }

  setServerMentionUnreadCount(serverId: string, mentionUnreadCount: number): void {
    const normalizedMentionUnreadCount = Math.max(0, mentionUnreadCount);
    this.servers.update((servers) =>
      servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              mention_unread_count: normalizedMentionUnreadCount,
            }
          : server
      )
    );
  }

  setChannelUnreadCount(channelId: string, unreadCount: number): void {
    const normalizedUnreadCount = Math.max(0, unreadCount);
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              unread_count: normalizedUnreadCount,
            }
          : channel
      )
    );
  }

  setChannelMentionUnreadCount(channelId: string, mentionUnreadCount: number): void {
    const normalizedMentionUnreadCount = Math.max(0, mentionUnreadCount);
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              mention_unread_count: normalizedMentionUnreadCount,
            }
          : channel
      )
    );
  }

  setChannelFirstUnreadMessageId(channelId: string, messageId: string | null): void {
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              first_unread_message_id: messageId,
            }
          : channel
      )
    );
  }

  setChannelFirstMentionUnreadMessageId(channelId: string, messageId: string | null): void {
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              first_mention_unread_message_id: messageId,
            }
          : channel
      )
    );
  }

  setChannelFirstUnreadMessageIdIfMissing(channelId: string, messageId: string): void {
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId && !channel.first_unread_message_id
          ? {
              ...channel,
              first_unread_message_id: messageId,
            }
          : channel
      )
    );
  }

  setChannelFirstMentionUnreadMessageIdIfMissing(channelId: string, messageId: string): void {
    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId && !channel.first_mention_unread_message_id
          ? {
              ...channel,
              first_mention_unread_message_id: messageId,
            }
          : channel
      )
    );
  }

  bumpServerUnreadCount(serverId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.servers.update((servers) =>
      servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              unread_count: Math.max(0, (server.unread_count ?? 0) + delta),
            }
          : server
      )
    );
  }

  bumpServerMentionUnreadCount(serverId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.servers.update((servers) =>
      servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              mention_unread_count: Math.max(0, (server.mention_unread_count ?? 0) + delta),
            }
          : server
      )
    );
  }

  bumpChannelUnreadCount(channelId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              unread_count: Math.max(0, (channel.unread_count ?? 0) + delta),
            }
          : channel
      )
    );
  }

  bumpChannelMentionUnreadCount(channelId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.channels.update((channels) =>
      channels.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              mention_unread_count: Math.max(0, (channel.mention_unread_count ?? 0) + delta),
            }
          : channel
      )
    );
  }

  setConversationUnreadCountByChannelId(channelId: string, unreadCount: number): void {
    const normalizedUnreadCount = Math.max(0, unreadCount);
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.primary_channel_id === channelId
          ? {
              ...conversation,
              unread_count: normalizedUnreadCount,
            }
          : conversation
      )
    );
  }

  setConversationMentionUnreadCountByChannelId(channelId: string, mentionUnreadCount: number): void {
    const normalizedMentionUnreadCount = Math.max(0, mentionUnreadCount);
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.primary_channel_id === channelId
          ? {
              ...conversation,
              mention_unread_count: normalizedMentionUnreadCount,
            }
          : conversation
      )
    );
  }

  setConversationFirstUnreadMessageIdByChannelId(channelId: string, messageId: string | null): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.primary_channel_id === channelId
          ? {
              ...conversation,
              first_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  setConversationFirstMentionUnreadMessageIdByChannelId(channelId: string, messageId: string | null): void {
    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.primary_channel_id === channelId
          ? {
              ...conversation,
              first_mention_unread_message_id: messageId,
            }
          : conversation
      )
    );
  }

  bumpConversationUnreadCount(serverId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              unread_count: Math.max(0, (conversation.unread_count ?? 0) + delta),
            }
          : conversation
      )
    );
  }

  bumpConversationMentionUnreadCount(serverId: string, delta = 1): void {
    if (!delta) {
      return;
    }

    this.conversations.update((conversations) =>
      conversations.map((conversation) =>
        conversation.id === serverId
          ? {
              ...conversation,
              mention_unread_count: Math.max(0, (conversation.mention_unread_count ?? 0) + delta),
            }
          : conversation
      )
    );
  }

}
