from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    password_confirmation: str = Field(min_length=8, max_length=128)
    nick: str = Field(min_length=2, max_length=32)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class AuthUserResponse(BaseModel):
    id: UUID
    public_id: int
    email: str
    nick: str
    avatar_updated_at: datetime | None
    is_admin: bool
    created_at: datetime

    @classmethod
    def from_user(cls, user: object) -> "AuthUserResponse":
        return cls(
            id=getattr(user, "id"),
            public_id=getattr(user, "public_id"),
            email=getattr(user, "email"),
            nick=getattr(user, "username"),
            avatar_updated_at=getattr(user, "avatar_updated_at"),
            is_admin=getattr(user, "is_admin"),
            created_at=getattr(user, "created_at"),
        )


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AuthUserResponse
