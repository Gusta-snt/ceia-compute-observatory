from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./observatory.db"
    secret_key: str = "change-me-in-production"
    session_hours: int = 12
    cookie_secure: bool = False
    cors_origins: str = ""  # lista separada por vírgulas; vazio = sem CORS (mesma origem)
    admin_username: str = "admin"
    admin_password: str = ""  # se definido e não houver usuários, cria o admin inicial
    timezone: str = "America/Sao_Paulo"
    raw_retention_days: int = 90
    max_body_bytes: int = 2_000_000
    max_batch_samples: int = 500
    ingest_rate_per_minute: int = 120
    background_tasks: bool = True
    use_timescale: bool = True

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
