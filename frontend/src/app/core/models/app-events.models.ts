import {
  WorkspaceChannel,
  WorkspaceChannelReadState,
  WorkspaceMember,
  WorkspaceMessage,
  VoiceJoinRequestSummary,
  WorkspaceMessageReactionsSnapshot,
  WorkspaceVoicePresenceChannel,
} from './workspace.models';

export interface AppEventsReadyEvent {
  type: 'ready';
  user_id: string;
}

export interface AppEventsPongEvent {
  type: 'pong';
}

export interface AppEventsErrorEvent {
  type: 'error';
  detail: string;
}

export interface AppPresenceUpdatedEvent {
  type: 'presence_updated';
  user_id: string;
  is_online: boolean;
  last_active_at: string;
}

export interface AppMessageCreatedEvent {
  type: 'message_created';
  server_id: string;
  message: WorkspaceMessage;
}

export interface AppMessageReactionsUpdatedEvent {
  type: 'message_reactions_updated';
  server_id: string;
  channel_id: string;
  snapshot: WorkspaceMessageReactionsSnapshot;
}

export interface AppMessageReadUpdatedEvent {
  type: 'message_read_updated';
  server_id: string;
  channel_id: string;
  state: WorkspaceChannelReadState & {
    nick: string;
    public_id: number;
    avatar_updated_at: string | null;
  };
}

export interface AppAttachmentDeletedEvent {
  type: 'attachment_deleted';
  server_id: string;
  channel_id: string;
  attachment_id: string;
}

export interface AppChannelsUpdatedEvent {
  type: 'channels_updated';
  server_id: string;
  reason: string;
  channels: WorkspaceChannel[];
}

export interface AppMembersUpdatedEvent {
  type: 'members_updated';
  server_id: string;
  reason: string;
  members: WorkspaceMember[];
}

export interface AppVoicePresenceUpdatedEvent {
  type: 'voice_presence_updated';
  server_id: string;
  voice_presence: WorkspaceVoicePresenceChannel[];
}

export interface AppServersChangedEvent {
  type: 'servers_changed';
  reason: string;
}

export interface AppServerChangedEvent {
  type: 'server_changed';
  server_id: string;
  reason: string;
}

export interface AppVoiceInboxChangedEvent {
  type: 'voice_inbox_changed';
}

export interface AppVoiceRequestResolvedEvent {
  type: 'voice_request_resolved';
  request: VoiceJoinRequestSummary;
}

export interface AppFriendRequestsChangedEvent {
  type: 'friend_requests_changed';
  pending_incoming_count: number;
}

export type AppEventsMessage =
  | AppEventsReadyEvent
  | AppEventsPongEvent
  | AppEventsErrorEvent
  | AppPresenceUpdatedEvent
  | AppMessageCreatedEvent
  | AppMessageReactionsUpdatedEvent
  | AppMessageReadUpdatedEvent
  | AppAttachmentDeletedEvent
  | AppChannelsUpdatedEvent
  | AppMembersUpdatedEvent
  | AppVoicePresenceUpdatedEvent
  | AppServersChangedEvent
  | AppServerChangedEvent
  | AppVoiceInboxChangedEvent
  | AppVoiceRequestResolvedEvent
  | AppFriendRequestsChangedEvent;
