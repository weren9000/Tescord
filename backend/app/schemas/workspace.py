from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ServerSummary(BaseModel):
    id: UUID
    name: str
    slug: str
    description: str | None
    member_role: str


class CreateServerRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)


class ChannelSummary(BaseModel):
    id: UUID
    server_id: UUID
    name: str
    topic: str | None
    type: str
    position: int
    voice_access_role: str | None = None


class ServerMemberSummary(BaseModel):
    id: UUID
    user_id: UUID
    login: str
    nick: str
    full_name: str
    character_name: str | None
    role: str
    is_online: bool = False


class VoicePresenceParticipantSummary(BaseModel):
    participant_id: str
    user_id: UUID
    nick: str
    full_name: str
    muted: bool
    owner_muted: bool


class VoiceChannelPresenceSummary(BaseModel):
    channel_id: UUID
    channel_name: str
    participants: list[VoicePresenceParticipantSummary]


class CreateChannelRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    topic: str | None = Field(default=None, max_length=255)
    type: Literal["text", "voice"] = "text"


class MessageAuthorSummary(BaseModel):
    id: UUID
    login: str
    nick: str
    full_name: str
    character_name: str | None


class MessageAttachmentSummary(BaseModel):
    id: UUID
    filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime


class ChannelMessageSummary(BaseModel):
    id: UUID
    channel_id: UUID
    type: str
    content: str
    created_at: datetime
    edited_at: datetime | None
    author: MessageAuthorSummary
    attachments: list[MessageAttachmentSummary]


class ChannelMessagesPage(BaseModel):
    items: list[ChannelMessageSummary]
    has_more: bool
    next_before: UUID | None
