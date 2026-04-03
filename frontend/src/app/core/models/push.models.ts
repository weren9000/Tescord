export interface PushConfigResponse {
  enabled: boolean;
  vapid_public_key: string | null;
}

export interface PushSubscriptionUpsertRequest {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  user_agent?: string | null;
}

export interface ConversationPushSettingRequest {
  push_enabled: boolean;
}

export interface ConversationPushSettingSummary {
  conversation_id: string;
  push_enabled: boolean;
}
