from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Tescord API"
    api_prefix: str = "/api"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = True
    database_url: str = "postgresql+psycopg://tescord:tescord@localhost:5432/tescord"
    cors_origins: list[str] = ["http://localhost:4200"]
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "testserver"]
    secret_key: str = "tescord-dev-secret-key"
    access_token_expire_minutes: int = 60 * 24 * 7
    seed_demo_data: bool = True
    demo_login: str = "weren9000"
    demo_nick: str = "weren9000"
    demo_full_name: str = "Верен Чебыкин"
    demo_character_name: str = "Архимаг Кельн"
    demo_password: str = "Vfrfhjys9000"
    demo_is_admin: bool = True
    demo_server_name: str = "Forgehold Collective"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="TESCORD_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
