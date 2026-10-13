from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class CurrentUserResponse(BaseModel):
    id: UUID
    public_id: int
    email: str
    nick: str
    avatar_updated_at: datetime | None
    avatar_preset: str
    has_uploaded_avatar: bool
    is_admin: bool
    is_avatar_admin: bool
    avatar_item_id: UUID | None = None
    created_at: datetime

    @classmethod
    def from_user(cls, user: object) -> "CurrentUserResponse":
        return cls(
            id=getattr(user, "id"),
            public_id=getattr(user, "public_id"),
            email=getattr(user, "email"),
            nick=getattr(user, "username"),
            avatar_updated_at=getattr(user, "avatar_updated_at"),
            avatar_preset=getattr(user, "avatar_preset"),
            has_uploaded_avatar=getattr(user, "avatar_filename") is not None,
            is_admin=getattr(user, "is_admin"),
            is_avatar_admin=getattr(user, "is_avatar_admin"),
            created_at=getattr(user, "created_at"),
        )


class UpdateCurrentUserProfileResponse(CurrentUserResponse):
    pass
