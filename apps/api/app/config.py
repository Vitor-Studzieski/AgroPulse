import secrets

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongo_uri: str = "mongodb://localhost:27017/?directConnection=true"
    mongo_db: str = "agropulse"
    jwt_secret: str = Field(default_factory=lambda: secrets.token_urlsafe(48), min_length=32)
    jwt_expire_minutes: int = 120
    cors_origins: str = "http://localhost:3000"
    readings_ttl_days: int = Field(default=180, ge=1, le=3650)


settings = Settings()
