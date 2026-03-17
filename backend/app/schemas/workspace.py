from __future__ import annotations

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


class ServerMemberSummary(BaseModel):
    id: UUID
    user_id: UUID
    login: str
    nick: str
    full_name: str
    character_name: str | None
    role: str


class CreateChannelRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    topic: str | None = Field(default=None, max_length=255)
    type: Literal["text", "voice"] = "text"
