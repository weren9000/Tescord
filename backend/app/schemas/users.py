from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class CurrentUserResponse(BaseModel):
    id: UUID
    login: str
    full_name: str
    nick: str
    character_name: str | None
    avatar_updated_at: datetime | None
    is_admin: bool
    created_at: datetime

    @classmethod
    def from_user(cls, user: object) -> "CurrentUserResponse":
        return cls(
            id=getattr(user, "id"),
            login=getattr(user, "email"),
            full_name=getattr(user, "display_name"),
            nick=getattr(user, "username"),
            character_name=getattr(user, "bio"),
            avatar_updated_at=getattr(user, "avatar_updated_at"),
            is_admin=getattr(user, "is_admin"),
            created_at=getattr(user, "created_at"),
        )


class UpdateCurrentUserProfileResponse(CurrentUserResponse):
    pass
