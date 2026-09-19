# tracker_backend/config.py
from pydantic_settings import BaseSettings


class Settings(BaseSettings):

    TRACCAR_URL: str
    TRACCAR_EMAIL: str
    TRACCAR_PASSWORD: str
    FRONTEND_URL: str 
    ORS_API_KEY: str

    DB_USER: str
    DB_PASSWORD: str
    DB_HOST: str
    DB_PORT: int
    DB_NAME: str

    JWT_SECRET: str
    JWT_EXPIRE_MINUTES: int = 480
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str
    PASSWORD_ENC_KEY: str
    LOGIN_RATE_LIMIT_CALLS: int = 10
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 60


    class Config:
        env_file = ".env"


# Single instance used everywhere
settings = Settings()