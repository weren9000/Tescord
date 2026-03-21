from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    login: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=96)
    nick: str = Field(min_length=2, max_length=32)
    character_name: str = Field(min_length=2, max_length=64)


class LoginRequest(BaseModel):
    login: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)


class AuthUserResponse(BaseModel):
    id: UUID
    login: str
    full_name: str
    nick: str
    character_name: str | None
    avatar_updated_at: datetime | None
    is_admin: bool
    created_at: datetime

    @classmethod
    def from_user(cls, user: object) -> "AuthUserResponse":
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


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUserResponse
