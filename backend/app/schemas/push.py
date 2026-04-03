from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class PushConfigResponse(BaseModel):
    enabled: bool
    vapid_public_key: str | None = None


class PushSubscriptionKeysRequest(BaseModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class PushSubscriptionUpsertRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=4096)
    keys: PushSubscriptionKeysRequest
    user_agent: str | None = Field(default=None, max_length=512)


class ConversationPushSettingRequest(BaseModel):
    push_enabled: bool


class ConversationPushSettingSummary(BaseModel):
    conversation_id: UUID
    push_enabled: bool
