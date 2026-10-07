"""ORM models for the four tables in schema_6.sql.

Importing this package registers every table on Base.metadata.
"""

from app.models.attachment import MeetingAttachment
from app.models.enums import (
    AttachmentKind,
    EncryptionMode,
    MeetingIdType,
    MeetingStatus,
    MeetingType,
    NotesScope,
    ParticipantRole,
    ParticipantStatus,
)
from app.models.meeting import Meeting
from app.models.participant import MeetingParticipant
from app.models.user import User

__all__ = [
    "AttachmentKind",
    "EncryptionMode",
    "Meeting",
    "MeetingAttachment",
    "MeetingIdType",
    "MeetingParticipant",
    "MeetingStatus",
    "MeetingType",
    "NotesScope",
    "ParticipantRole",
    "ParticipantStatus",
    "User",
]
