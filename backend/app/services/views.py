"""Read-only results returned by the services: plain data, safe to serialize.

Services never hand ORM rows to their callers. Secrets are excluded by
construction: participant views have no client_token, and a meeting's
passcode is only filled in for a caller authorized as its owner or host
(otherwise `has_passcode` says whether one exists). `passcode_required` says
whether joining asks for it: only a scheduled meeting's passcode does; an instant
meeting's passcode is shown and shared but not needed to join. Passcodes are also kept
out of repr() so they cannot end up in logs.
"""

from dataclasses import dataclass, field
from datetime import datetime

from app.models import Meeting, MeetingAttachment, MeetingIdType, MeetingParticipant, MeetingType
from app.services.meeting_code import invite_url
from app.services.time_limit import meeting_ends_at


def passcode_required(meeting: Meeting) -> bool:
    """Joining asks for the passcode of a scheduled meeting only."""
    return meeting.passcode is not None and meeting.meeting_type == MeetingType.SCHEDULED


@dataclass(frozen=True)
class AttachmentView:
    id: int
    kind: str
    title: str
    created_at: datetime

    @classmethod
    def of(cls, attachment: MeetingAttachment) -> "AttachmentView":
        return cls(attachment.id, attachment.kind, attachment.title, attachment.created_at)


@dataclass(frozen=True)
class ParticipantView:
    """One join of one browser. Deliberately has no client_token."""

    id: int
    user_id: int | None
    display_name: str
    role: str
    status: str
    is_muted: bool
    is_video_on: bool
    joined_at: datetime
    left_at: datetime | None

    @classmethod
    def of(cls, row: MeetingParticipant) -> "ParticipantView":
        return cls(
            id=row.id,
            user_id=row.user_id,
            display_name=row.display_name,
            role=row.role,
            status=row.status,
            is_muted=row.is_muted,
            is_video_on=row.is_video_on,
            joined_at=row.joined_at,
            left_at=row.left_at,
        )


@dataclass(frozen=True)
class MeetingSummary:
    """What anyone with the meeting code may see: dashboard lists and the join page."""

    meeting_code: str  # the meeting's own 11-digit ID: the key of every owner/host API path
    meeting_id_type: str  # "generated" or "personal"
    # The ID people join with: meeting_code, or the host's 10-digit PMI for a personal meeting.
    public_meeting_id: str
    invite_url: str  # derived from FRONTEND_URL and public_meeting_id, never stored
    host_id: int
    title: str
    description: str | None
    meeting_type: str
    status: str
    scheduled_start_at: datetime | None
    duration_minutes: int | None
    timezone: str
    started_at: datetime | None
    ended_at: datetime | None
    ends_at: datetime | None  # when a started meeting reaches its time limit (time_limit.py)
    has_passcode: bool
    passcode_required: bool
    waiting_room_enabled: bool

    @staticmethod
    def _fields(meeting: Meeting) -> dict:
        public_id = (
            meeting.host.personal_meeting_id
            if meeting.meeting_id_type == MeetingIdType.PERSONAL
            else meeting.meeting_code
        )
        return {
            "meeting_code": meeting.meeting_code,
            "meeting_id_type": meeting.meeting_id_type,
            "public_meeting_id": public_id,
            "invite_url": invite_url(public_id),
            "host_id": meeting.host_id,
            "title": meeting.title,
            "description": meeting.description,
            "meeting_type": meeting.meeting_type,
            "status": meeting.status,
            "scheduled_start_at": meeting.scheduled_start_at,
            "duration_minutes": meeting.duration_minutes,
            "timezone": meeting.timezone,
            "started_at": meeting.started_at,
            "ended_at": meeting.ended_at,
            "ends_at": meeting_ends_at(meeting),
            "has_passcode": meeting.passcode is not None,
            "passcode_required": passcode_required(meeting),
            "waiting_room_enabled": meeting.waiting_room_enabled,
        }

    @classmethod
    def of(cls, meeting: Meeting) -> "MeetingSummary":
        return cls(**cls._fields(meeting))


@dataclass(frozen=True)
class MeetingDetails(MeetingSummary):
    """Everything the Manage Meeting page shows and the Edit form needs."""

    encryption_mode: str
    notes_enabled: bool
    notes_scope: str | None
    host_video_enabled: bool
    participant_video_enabled: bool
    template: str | None
    created_at: datetime
    updated_at: datetime
    attachments: tuple[AttachmentView, ...]
    # Filled in only for the meeting's owner or active host; None for anyone else.
    passcode: str | None = field(repr=False)

    @classmethod
    def of(cls, meeting: Meeting, *, include_passcode: bool) -> "MeetingDetails":  # type: ignore[override]
        return cls(
            **MeetingSummary._fields(meeting),
            encryption_mode=meeting.encryption_mode,
            notes_enabled=meeting.notes_enabled,
            notes_scope=meeting.notes_scope,
            host_video_enabled=meeting.host_video_enabled,
            participant_video_enabled=meeting.participant_video_enabled,
            template=meeting.template,
            created_at=meeting.created_at,
            updated_at=meeting.updated_at,
            attachments=tuple(AttachmentView.of(a) for a in meeting.attachments),
            passcode=meeting.passcode if include_passcode else None,
        )
