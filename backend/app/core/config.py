from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, SecretStr, model_validator


class Settings(BaseSettings):
    app_name: str = "Altgramm API"
    api_prefix: str = "/api"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = True
    database_url: str = "postgresql+psycopg://tescord:tescord@localhost:5432/tescord"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_timeout: float = 5
    cors_origins: list[str] = ["http://localhost:4200"]
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "testserver"]
    secret_key: str = "tescord-dev-secret-key"
    access_token_expire_minutes: int = 60 * 24 * 7
    seed_demo_data: bool = False
    demo_login: str = "weren9000@kva-chat.local"
    demo_nick: str = "weren9000"
    demo_password: str | None = None
    demo_is_admin: bool = True
    demo_server_name: str = "Altgramm"
    uploads_dir: str = "./storage/uploads"
    max_message_upload_bytes: int = 500 * 1024 * 1024
    user_upload_quota_bytes: int = 5 * 1024 * 1024 * 1024
    redis_url: str | None = None
    rate_limits_enabled: bool = False
    auth_encryption_key: SecretStr | None = None
    smtp_host: str | None = None
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_security: Literal['starttls', 'ssl', 'plain'] = 'starttls'
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_from: str | None = None
    livekit_internal_url: str = "http://127.0.0.1:7880"
    voice_room_capacity: int = Field(default=30, ge=1, le=30)
    push_vapid_public_key: str | None = None
    push_vapid_private_key_path: str | None = None
    push_vapid_subject: str | None = None
    livekit_url: str | None = None
    livekit_api_key: str | None = None
    livekit_api_secret: str | None = None
    turn_urls: list[str] = Field(default_factory=list)
    turn_shared_secret: SecretStr | None = None
    turn_credential_ttl_seconds: int = Field(default=86400, ge=600, le=86400)

    @model_validator(mode="after")
    def validate_production(self):
        if self.auth_encryption_key:
            from cryptography.fernet import Fernet
            try:
                Fernet(self.auth_encryption_key.get_secret_value().encode())
            except (ValueError, TypeError):
                raise ValueError('Invalid auth encryption key') from None
        if self.smtp_from and any(c in self.smtp_from for c in '\r\n'):
            raise ValueError('Invalid mail sender')
        if self.smtp_security == 'plain' and (self.environment != 'development' or self.smtp_host not in {'localhost', '127.0.0.1'}):
            raise ValueError('Plain SMTP is only allowed on local development servers')
        if bool(self.turn_urls) != bool(self.turn_shared_secret):
            raise ValueError('TURN requires both turn_urls and turn_shared_secret')
        if self.turn_shared_secret and len(self.turn_shared_secret.get_secret_value()) < 32:
            raise ValueError('TURN requires a new random shared secret of at least 32 characters')
        if any(not url.startswith(('turn:', 'turns:')) or any(c.isspace() for c in url) or '@' in url for url in self.turn_urls):
            raise ValueError('TURN URLs must be turn: or turns: addresses without credentials')
        if self.environment == "production":
            if self.debug or self.secret_key == "tescord-dev-secret-key" or len(self.secret_key) < 32:
                raise ValueError("Production requires debug=false and a strong secret_key")
            if self.seed_demo_data:
                raise ValueError("Production requires seed_demo_data=false")
            if not self.rate_limits_enabled or not self.redis_url:
                raise ValueError("Production requires rate limiting and redis_url")
        return self

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_from and self.auth_encryption_key)

    @property
    def push_notifications_enabled(self) -> bool:
        return bool(
            self.push_vapid_public_key
            and self.push_vapid_private_key_path
            and self.push_vapid_subject
        )

    @property
    def livekit_enabled(self) -> bool:
        return bool(
            self.livekit_url
            and self.livekit_api_key
            and self.livekit_api_secret
        )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="TESCORD_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
