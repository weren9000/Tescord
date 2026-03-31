from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ConversationMemberPreview(BaseModel):
    user_id: UUID
    public_id: int
    login: str
    nick: str
    avatar_updated_at: datetime | None
    is_online: bool
    role: str


class ConversationSummary(BaseModel):
    id: UUID
    kind: str
    title: str
    subtitle: str | None = None
    icon_asset: str | None = None
    member_role: str
    primary_channel_id: UUID
    members: list[ConversationMemberPreview] = Field(default_factory=list)


class ConversationDirectoryUserSummary(BaseModel):
    user_id: UUID
    public_id: int
    login: str
    nick: str
    avatar_updated_at: datetime | None
    is_online: bool


class CreateDirectConversationRequest(BaseModel):
    user_id: UUID


class CreateGroupConversationRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    member_ids: list[UUID] = Field(min_length=1, max_length=9)
    icon_asset: str | None = Field(default=None, max_length=255)
