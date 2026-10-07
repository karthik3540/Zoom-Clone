from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.router import api_router
from app.config import settings
from app.db.init_db import init_db

API_DESCRIPTION = (
    "Meetings, participants and attachments for the Zoom clone. There is no login: send "
    "`X-User-Id` (the account; the default user is 1) and `X-Client-Token` (the browser). "
    "Times are UTC. Errors have the shape `{\"error\": {\"code\", \"message\", ...}}`."
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Creates missing tables and seeds an empty database; existing data is kept.
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Zoom Clone API", description=API_DESCRIPTION, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-User-Id", "X-Client-Token"],
    )
    register_error_handlers(app)
    app.include_router(api_router)
    return app


app = create_app()
