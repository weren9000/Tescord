export interface AttentionMentionItem {
  kind: 'conversation_mention' | 'channel_mention';
  server_id: string;
  server_kind: 'group_chat' | 'workspace';
  server_name: string;
  channel_id: string;
  channel_name: string | null;
  icon_asset: string | null;
  icon_updated_at: string | null;
  unread_count: number;
  mention_unread_count: number;
  focus_message_id: string | null;
  preview: string | null;
  activity_at: string | null;
}

export interface AttentionInbox {
  mentions: AttentionMentionItem[];
}
