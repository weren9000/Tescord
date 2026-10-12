from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, field_validator
from urllib.parse import urlsplit


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

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: str) -> str:
        url = urlsplit(value)
        host = (url.hostname or "").lower()
        allowed = host in {"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"} or host.endswith(".notify.windows.com")
        if url.scheme != "https" or not allowed or url.port not in {None, 443} or url.username or url.password or url.fragment:
            raise ValueError("Unsupported push service endpoint")
        return value


class ConversationPushSettingRequest(BaseModel):
    push_enabled: bool


class ConversationPushSettingSummary(BaseModel):
    conversation_id: UUID
    push_enabled: bool
