import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATABASE_URL = f"sqlite:///{(BACKEND_DIR / 'data' / 'zoom_clone.db').as_posix()}"
DEFAULT_FRONTEND_URL = "http://localhost:3000"


@dataclass(frozen=True)
class Settings:
    cors_origins: list[str]
    database_url: str
    # Base URL of the frontend, used to build invite links ({frontend_url}/j/{code}).
    frontend_url: str


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def load_settings() -> Settings:
    return Settings(
        cors_origins=_split_csv(os.getenv("CORS_ORIGINS", DEFAULT_FRONTEND_URL)),
        database_url=os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL),
        frontend_url=os.getenv("FRONTEND_URL", DEFAULT_FRONTEND_URL).rstrip("/"),
    )


settings = load_settings()
