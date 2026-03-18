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


class VoiceAccessUserSummary(BaseModel):
    user_id: UUID
    login: str
    nick: str
    full_name: str


class VoiceChannelAccessEntry(BaseModel):
    user_id: UUID
    login: str
    nick: str
    full_name: str
    role: Literal["owner", "resident", "stranger"]
    blocked_until: datetime | None
    temporary_access_until: datetime | None


class VoiceChannelAccessUpdateRequest(BaseModel):
    role: Literal["owner", "resident", "stranger"] | None


class VoiceJoinRequestSummary(BaseModel):
    id: UUID
    channel_id: UUID
    channel_name: str
    requester_user_id: UUID
    requester_nick: str
    requester_full_name: str
    status: Literal["pending", "allowed", "resident", "rejected", "cancelled"]
    created_at: datetime
    resolved_at: datetime | None


class VoiceJoinRequestCreateResponse(BaseModel):
    request: VoiceJoinRequestSummary | None
    can_join_now: bool
    detail: str


class ResolveVoiceJoinRequest(BaseModel):
    action: Literal["allow", "resident", "reject"]
