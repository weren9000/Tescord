from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class VoiceChannelCatalogItem(BaseModel):
    channel_id: UUID
    server_id: UUID
    server_name: str
    channel_name: str
    owner_user_id: UUID | None
    owner_nick: str | None
    owner_avatar_updated_at: datetime | None = None


class VoiceAccessUserSummary(BaseModel):
    user_id: UUID
    login: str
    nick: str
    avatar_updated_at: datetime | None
    is_online: bool = False


class VoiceChannelAccessEntry(BaseModel):
    user_id: UUID
    login: str
    nick: str
    avatar_updated_at: datetime | None
    role: Literal["owner", "resident", "guest", "stranger"]
    is_online: bool = False
    is_in_channel: bool = False
    muted: bool = False
    owner_muted: bool
    blocked_until: datetime | None
    temporary_access_until: datetime | None


class VoiceChannelAccessUpdateRequest(BaseModel):
    role: Literal["owner", "resident", "guest", "stranger"] | None


class VoiceOwnerMuteUpdateRequest(BaseModel):
    owner_muted: bool


class VoiceJoinRequestSummary(BaseModel):
    id: UUID
    server_id: UUID
    server_name: str
    channel_id: UUID
    channel_name: str
    requester_user_id: UUID
    requester_nick: str
    requester_avatar_updated_at: datetime | None = None
    status: Literal["pending", "allowed", "resident", "rejected", "cancelled"]
    created_at: datetime
    resolved_at: datetime | None
    blocked_until: datetime | None = None
    retry_after_seconds: int | None = None


class VoiceJoinRequestCreateResponse(BaseModel):
    request: VoiceJoinRequestSummary | None
    can_join_now: bool
    detail: str
    blocked_until: datetime | None = None
    retry_after_seconds: int | None = None


class ResolveVoiceJoinRequest(BaseModel):
    action: Literal["allow", "resident", "reject"]
