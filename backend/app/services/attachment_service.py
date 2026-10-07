"""Whiteboards and docs attached to a meeting.

An attachment records the attachment itself (kind and name); the whiteboard
and document products are not part of this application. Adding and removing
are edits to the meeting, so the edit rules apply: owner's account only,
and only while the meeting is scheduled. Removing deletes the row; deleting
a meeting removes its attachments through the database's ON DELETE CASCADE.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import atomic
from app.models import MeetingAttachment
from app.services.exceptions import AttachmentNotFound
from app.services.meeting_service import get_meeting, require_editable, require_owner
from app.services.meeting_settings import validate_attachment
from app.services.views import AttachmentView


def list_attachments(session: Session, meeting_code: str) -> list[AttachmentView]:
    """The meeting's attachments, in the order they were added."""
    return [AttachmentView.of(attachment) for attachment in get_meeting(session, meeting_code).attachments]


def add_attachment(session: Session, meeting_code: str, *, user_id: int, kind: str, title: str) -> AttachmentView:
    kind, title = validate_attachment(kind, title)
    meeting = get_meeting(session, meeting_code)
    require_editable(meeting, "change attachments of")
    require_owner(meeting, user_id, "change attachments of")

    with atomic(session):
        attachment = MeetingAttachment(meeting_id=meeting.id, kind=kind, title=title)
        session.add(attachment)
        session.flush()
        view = AttachmentView.of(attachment)
    return view


def remove_attachment(session: Session, meeting_code: str, *, user_id: int, attachment_id: int) -> None:
    meeting = get_meeting(session, meeting_code)
    require_editable(meeting, "change attachments of")
    require_owner(meeting, user_id, "change attachments of")

    with atomic(session):
        attachment = (
            session.scalar(
                select(MeetingAttachment).where(
                    MeetingAttachment.id == attachment_id, MeetingAttachment.meeting_id == meeting.id
                )
            )
            if isinstance(attachment_id, int)
            else None
        )
        if attachment is None:
            raise AttachmentNotFound("No such attachment on this meeting")
        session.delete(attachment)
