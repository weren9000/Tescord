export interface CurrentUserResponse {
  id: string;
  public_id: number;
  email: string;
  nick: string;
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
  icon_updated_at: string | null;
  member_role: string;
  kind: 'workspace' | 'direct' | 'group_chat';
  unread_count: number;
}

export interface WorkspaceChannel {
  id: string;
  server_id: string;
  name: string;
  topic: string | null;
  type: 'text' | 'voice' | 'announcement';
  position: number;
  voice_access_role: 'owner' | 'resident' | 'guest' | 'stranger' | null;
  unread_count: number;
}

export interface WorkspaceMember {
  id: string;
  user_id: string;
  public_id: number;
  login: string;
  nick: string;
  avatar_updated_at: string | null;
  role: string;
  is_online: boolean;
}

export interface WorkspaceVoicePresenceParticipant {
  participant_id: string;
  user_id: string;
  public_id: number;
  nick: string;
  avatar_updated_at: string | null;
  muted: boolean;
  owner_muted: boolean;
}

export interface WorkspaceVoicePresenceChannel {
  channel_id: string;
  channel_name: string;
  participants: WorkspaceVoicePresenceParticipant[];
}

export interface BlockedServerSummary {
  server_id: string;
  name: string;
  icon_asset: string | null;
  icon_updated_at: string | null;
  kind: 'workspace' | 'group_chat';
  blocked_at: string;
}

export interface CreateWorkspaceServerRequest {
  name: string;
  description: string | null;
}

export interface AddWorkspaceMemberRequest {
  user_id?: string | null;
  user_public_id?: number | null;
}

export interface LeaveWorkspaceServerRequest {
  new_owner_user_id?: string | null;
  close_group?: boolean;
  block_after_leave?: boolean;
}

export interface CreateWorkspaceChannelRequest {
  name: string;
  topic: string | null;
  type: 'text' | 'voice';
}

export interface WorkspaceMessageAuthor {
  id: string;
  public_id: number;
  login: string;
  nick: string;
  avatar_updated_at: string | null;
}

export interface WorkspaceMessageReadUser {
  id: string;
  public_id: number;
  nick: string;
  avatar_updated_at: string | null;
}

export interface WorkspaceMessageAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  deleted_at: string | null;
}

export interface WorkspaceAttachmentDownloadLink {
  url: string;
  expires_at: string;
}

export interface WorkspaceChatAttachmentSummary {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  author: WorkspaceMessageAuthor;
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

export interface WorkspaceMessageReply {
  id: string;
  content: string;
  created_at: string;
  author: WorkspaceMessageAuthor;
  attachments_count: number;
}

export interface WorkspaceMessage {
  id: string;
  channel_id: string;
  type: 'text' | 'system';
  content: string;
  created_at: string;
  edited_at: string | null;
  author: WorkspaceMessageAuthor;
  reply_to: WorkspaceMessageReply | null;
  attachments: WorkspaceMessageAttachment[];
  reactions: WorkspaceMessageReaction[];
  read_by: WorkspaceMessageReadUser[];
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

export interface WorkspaceChannelReadState {
  channel_id: string;
  user_id: string;
  last_read_message_id: string | null;
  last_read_at: string;
}

export interface VoiceAdminChannel {
  channel_id: string;
  server_id: string;
  server_name: string;
  channel_name: string;
  owner_user_id: string | null;
  owner_nick: string | null;
  owner_avatar_updated_at: string | null;
}

export interface VoiceAdminUser {
  user_id: string;
  login: string;
  nick: string;
  avatar_updated_at: string | null;
  is_online: boolean;
}

export interface VoiceChannelAccessEntry {
  user_id: string;
  login: string;
  nick: string;
  avatar_updated_at: string | null;
  role: 'owner' | 'resident' | 'guest' | 'stranger';
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
