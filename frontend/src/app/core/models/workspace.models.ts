export interface CurrentUserResponse {
  id: string;
  login: string;
  full_name: string;
  nick: string;
  character_name: string | null;
  avatar_updated_at: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface WorkspaceServer {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon_asset: string | null;
  member_role: string;
}

export interface WorkspaceChannel {
  id: string;
  server_id: string;
  name: string;
  topic: string | null;
  type: 'text' | 'voice' | 'announcement';
  position: number;
  voice_access_role: 'owner' | 'resident' | 'stranger' | null;
}

export interface WorkspaceMember {
  id: string;
  user_id: string;
  login: string;
  nick: string;
  full_name: string;
  character_name: string | null;
  avatar_updated_at: string | null;
  role: string;
  is_online: boolean;
}

export interface WorkspaceVoicePresenceParticipant {
  participant_id: string;
  user_id: string;
  nick: string;
  full_name: string;
  character_name: string | null;
  avatar_updated_at: string | null;
  muted: boolean;
  owner_muted: boolean;
}

export interface WorkspaceVoicePresenceChannel {
  channel_id: string;
  channel_name: string;
  participants: WorkspaceVoicePresenceParticipant[];
}

export interface CreateWorkspaceServerRequest {
  name: string;
  description: string | null;
}

export interface CreateWorkspaceChannelRequest {
  name: string;
  topic: string | null;
  type: 'text' | 'voice';
}

export interface WorkspaceMessageAuthor {
  id: string;
  login: string;
  nick: string;
  full_name: string;
  character_name: string | null;
  avatar_updated_at: string | null;
}

export interface WorkspaceMessageAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export type WorkspaceMessageReactionCode =
  | 'heart'
  | 'like'
  | 'dislike'
  | 'angry'
  | 'cry'
  | 'confused'
  | 'displeased'
  | 'laugh'
  | 'fire'
  | 'wow'
  | 'praying_cat';

export interface WorkspaceMessageReaction {
  code: WorkspaceMessageReactionCode;
  count: number;
  reacted: boolean;
}

export interface WorkspaceMessage {
  id: string;
  channel_id: string;
  type: 'text' | 'system';
  content: string;
  created_at: string;
  edited_at: string | null;
  author: WorkspaceMessageAuthor;
  attachments: WorkspaceMessageAttachment[];
  reactions: WorkspaceMessageReaction[];
}

export interface WorkspaceMessagePage {
  items: WorkspaceMessage[];
  has_more: boolean;
  next_before: string | null;
}

export interface WorkspaceMessageReactionsSnapshot {
  message_id: string;
  channel_id: string;
  reactions: WorkspaceMessageReaction[];
}

export interface VoiceAdminChannel {
  channel_id: string;
  server_id: string;
  server_name: string;
  channel_name: string;
  owner_user_id: string | null;
  owner_nick: string | null;
  owner_character_name: string | null;
  owner_avatar_updated_at: string | null;
}

export interface VoiceAdminUser {
  user_id: string;
  login: string;
  nick: string;
  full_name: string;
  character_name: string | null;
  avatar_updated_at: string | null;
  is_online: boolean;
}

export interface VoiceChannelAccessEntry {
  user_id: string;
  login: string;
  nick: string;
  full_name: string;
  character_name: string | null;
  avatar_updated_at: string | null;
  role: 'owner' | 'resident' | 'stranger';
  is_online: boolean;
  is_in_channel: boolean;
  muted: boolean;
  owner_muted: boolean;
  blocked_until: string | null;
  temporary_access_until: string | null;
}

export interface VoiceJoinRequestSummary {
  id: string;
  channel_id: string;
  channel_name: string;
  requester_user_id: string;
  requester_nick: string;
  requester_full_name: string;
  requester_character_name: string | null;
  requester_avatar_updated_at: string | null;
  status: 'pending' | 'allowed' | 'resident' | 'rejected' | 'cancelled';
  created_at: string;
  resolved_at: string | null;
  blocked_until: string | null;
  retry_after_seconds: number | null;
}

export interface VoiceJoinRequestCreateResponse {
  request: VoiceJoinRequestSummary | null;
  can_join_now: boolean;
  detail: string;
  blocked_until: string | null;
  retry_after_seconds: number | null;
}
