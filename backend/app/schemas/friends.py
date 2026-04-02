from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class FriendRequestUserSummary(BaseModel):
    user_id: UUID
    public_id: int
    login: str
    nick: str
    avatar_updated_at: datetime | None
    is_online: bool


class FriendRequestSummary(BaseModel):
    id: UUID
    status: str
    direction: str
    created_at: datetime
    responded_at: datetime | None = None
    user: FriendRequestUserSummary


class FriendRequestsOverview(BaseModel):
    incoming: list[FriendRequestSummary]
    outgoing: list[FriendRequestSummary]


class BlockedFriendSummary(BaseModel):
    user_id: UUID
    public_id: int
    login: str
    nick: str
    avatar_updated_at: datetime | None
    is_online: bool
    blocked_at: datetime


class CreateFriendRequestRequest(BaseModel):
    user_id: UUID | None = None
    user_public_id: int | None = Field(default=None, ge=10000, le=99999)

    @model_validator(mode="after")
    def validate_target(self) -> "CreateFriendRequestRequest":
        if (self.user_id is None) == (self.user_public_id is None):
            raise ValueError("Нужно указать пользователя по UUID или пятизначному ID")
        return self
