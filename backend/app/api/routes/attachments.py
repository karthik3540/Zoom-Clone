"""Whiteboards and docs attached to a meeting.

They are added and replaced through the Schedule / Edit form (POST /meetings/scheduled,
PATCH /meetings/{code}) and listed in the meeting details; the Manage page removes one here.
"""

from fastapi import APIRouter, Response

from app.api.deps import DbSession, UserId
from app.schemas.meetings import ErrorResponse
from app.services import attachment_service

router = APIRouter(prefix="/meetings/{meeting_code}/attachments", tags=["attachments"])

ERRORS = {status: {"model": ErrorResponse} for status in (403, 404, 409, 422)}


@router.delete("/{attachment_id}", status_code=204, response_class=Response, responses=ERRORS,
               summary="Remove an attachment")
def remove_attachment(meeting_code: str, attachment_id: int, db: DbSession, user_id: UserId) -> Response:
    """Deletes the attachment. Owner's account only, while the meeting is scheduled."""
    attachment_service.remove_attachment(db, meeting_code, user_id=user_id, attachment_id=attachment_id)
    return Response(status_code=204)
