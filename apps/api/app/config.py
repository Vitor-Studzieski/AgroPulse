from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongo_uri: str = "mongodb://localhost:27017/?directConnection=true"
    mongo_db: str = "agropulse"
    jwt_secret: str = "troque-esta-chave"
    jwt_expire_minutes: int = 120
    cors_origins: str = "http://localhost:3000"


settings = Settings()
