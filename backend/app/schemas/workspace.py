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
    icon_asset: str | None = None
    member_role: str
    kind: str = "workspace"


class CreateServerRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)


class UpdateServerIconRequest(BaseModel):
    icon_asset: str | None = Field(default=None, max_length=255)


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
    avatar_updated_at: datetime | None
    role: str
    is_online: bool = False


class VoicePresenceParticipantSummary(BaseModel):
    participant_id: str
    user_id: UUID
    nick: str
    full_name: str
    character_name: str | None
    avatar_updated_at: datetime | None
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
    avatar_updated_at: datetime | None


class MessageReadUserSummary(BaseModel):
    id: UUID
    nick: str
    character_name: str | None
    avatar_updated_at: datetime | None


class MessageAttachmentSummary(BaseModel):
    id: UUID
    filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime


class MessageReactionSummary(BaseModel):
    code: str
    count: int
    reacted: bool


class MessageReplySummary(BaseModel):
    id: UUID
    content: str
    created_at: datetime
    author: MessageAuthorSummary
    attachments_count: int


class ChannelMessageSummary(BaseModel):
    id: UUID
    channel_id: UUID
    type: str
    content: str
    created_at: datetime
    edited_at: datetime | None
    author: MessageAuthorSummary
    reply_to: MessageReplySummary | None = None
    attachments: list[MessageAttachmentSummary]
    reactions: list[MessageReactionSummary]
    read_by: list[MessageReadUserSummary] = Field(default_factory=list)


class MessageReactionsSnapshot(BaseModel):
    message_id: UUID
    channel_id: UUID
    reactions: list[MessageReactionSummary]


class ChannelMessagesPage(BaseModel):
    items: list[ChannelMessageSummary]
    has_more: bool
    next_before: UUID | None


class MarkChannelReadRequest(BaseModel):
    last_message_id: UUID | None = None


class ChannelReadStateSummary(BaseModel):
    channel_id: UUID
    user_id: UUID
    last_read_message_id: UUID | None
    last_read_at: datetime
