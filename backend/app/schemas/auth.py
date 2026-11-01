from __future__ import annotations

from datetime import datetime
import re
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


EMAIL_PATTERN = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$"
)


def _normalize_email(value: str) -> str:
    normalized = value.strip().lower()
    if not EMAIL_PATTERN.fullmatch(normalized):
        raise ValueError("Нужно указать корректную почту")
    return normalized


class RegisterRequest(BaseModel):
    registration_token: str | None = Field(default=None, min_length=32, max_length=128)
    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    password_confirmation: str = Field(min_length=8, max_length=128)
    nick: str = Field(min_length=2, max_length=32)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return _normalize_email(value)


class LoginRequest(BaseModel):
    auth_protocol: int = 1
    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return _normalize_email(value)


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


class EmailStartRequest(BaseModel):
    email: str = Field(min_length=5, max_length=320)
    challenge_token: str | None = Field(default=None, min_length=32, max_length=128)

    @field_validator('email')
    @classmethod
    def validate_email(cls, value: str) -> str:
        return _normalize_email(value)


class ChallengeResponse(BaseModel):
    challenge_token: str
    expires_in: int
    resend_after: int = 60


class CodeRequest(BaseModel):
    challenge_token: str = Field(min_length=32, max_length=128)
    code: str = Field(min_length=1, max_length=64)


class EmailVerifiedResponse(BaseModel):
    registration_token: str
    email: str


class TwoFactorRequired(BaseModel):
    status: str = 'two_factor_required'
    challenge_token: str
    expires_in: int = 300


class PasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class SecurityActionRequest(PasswordRequest):
    code: str = Field(min_length=1, max_length=64)
