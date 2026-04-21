from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Altgramm API"
    api_prefix: str = "/api"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = True
    database_url: str = "postgresql+psycopg://tescord:tescord@localhost:5432/tescord"
    cors_origins: list[str] = ["http://localhost:4200"]
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "testserver"]
    secret_key: str = "tescord-dev-secret-key"
    access_token_expire_minutes: int = 60 * 24 * 7
    seed_demo_data: bool = True
    demo_login: str = "weren9000@kva-chat.local"
    demo_nick: str = "weren9000"
    demo_password: str = "Vfrfhjys9000"
    demo_is_admin: bool = True
    demo_server_name: str = "Altgramm"
    uploads_dir: str = "./storage/uploads"
    push_vapid_public_key: str | None = None
    push_vapid_private_key_path: str | None = None
    push_vapid_subject: str | None = None
    livekit_url: str | None = None
    livekit_api_key: str | None = None
    livekit_api_secret: str | None = None

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
