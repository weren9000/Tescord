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
    is_admin: bool
    created_at: datetime

    @classmethod
    def from_user(cls, user: object) -> "CurrentUserResponse":
        return cls(
            id=getattr(user, "id"),
            public_id=getattr(user, "public_id"),
            email=getattr(user, "email"),
            nick=getattr(user, "username"),
            avatar_updated_at=getattr(user, "avatar_updated_at"),
            is_admin=getattr(user, "is_admin"),
            created_at=getattr(user, "created_at"),
        )


class UpdateCurrentUserProfileResponse(CurrentUserResponse):
    pass
