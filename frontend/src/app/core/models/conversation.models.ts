export interface ConversationMemberPreview {
  user_id: string;
  login: string;
  nick: string;
  full_name: string;
  character_name: string | null;
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
  member_role: string;
  primary_channel_id: string;
  members: ConversationMemberPreview[];
}

export interface ConversationDirectoryUser {
  user_id: string;
  login: string;
  nick: string;
  full_name: string;
  character_name: string | null;
  avatar_updated_at: string | null;
  is_online: boolean;
}

export interface CreateDirectConversationRequest {
  user_id: string;
}

export interface CreateGroupConversationRequest {
  name: string;
  member_ids: string[];
  icon_asset: string | null;
}
