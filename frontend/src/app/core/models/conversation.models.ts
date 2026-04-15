export interface ConversationMemberPreview {
  user_id: string;
  public_id: number;
  login: string;
  nick: string;
  avatar_updated_at: string | null;
  is_online: boolean;
  role: string;
}

export interface ConversationSummary {
  id: string;
  kind: 'direct' | 'group_chat';
  title: string;
  subtitle: string | null;
  icon_asset: string | null;
  icon_updated_at: string | null;
  member_role: string;
  primary_channel_id: string;
  unread_count: number;
  mention_unread_count: number;
  first_unread_message_id: string | null;
  first_mention_unread_message_id: string | null;
  push_enabled: boolean;
  members: ConversationMemberPreview[];
}

export interface ConversationDirectoryUser {
  user_id: string;
  public_id: number;
  login: string;
  nick: string;
  avatar_updated_at: string | null;
  is_online: boolean;
}

export interface CreateDirectConversationRequest {
  user_id?: string | null;
  user_public_id?: number | null;
}

export interface CreateGroupConversationRequest {
  name: string;
  member_ids: string[];
}
