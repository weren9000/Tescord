from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AttentionMentionItem(BaseModel):
    kind: Literal["conversation_mention", "channel_mention"]
    server_id: UUID
    server_kind: Literal["group_chat", "workspace"]
    server_name: str
    channel_id: UUID
    channel_name: str | None = None
    icon_asset: str | None = None
    icon_updated_at: datetime | None = None
    unread_count: int = 0
    mention_unread_count: int = 0
    focus_message_id: UUID | None = None
    preview: str | None = None
    activity_at: datetime | None = None


class AttentionInbox(BaseModel):
    mentions: list[AttentionMentionItem] = Field(default_factory=list)
