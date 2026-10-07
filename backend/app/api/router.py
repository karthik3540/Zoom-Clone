from fastapi import APIRouter

from app.api.routes import attachments, health, meetings, participants, users

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(users.router)
api_router.include_router(meetings.router)
api_router.include_router(participants.router)
api_router.include_router(attachments.router)
