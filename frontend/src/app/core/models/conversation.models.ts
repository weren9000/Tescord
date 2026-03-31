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
  member_role: string;
  primary_channel_id: string;
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
  icon_asset: string | null;
}
