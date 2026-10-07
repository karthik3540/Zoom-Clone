"""Seed data from schema_6.sql, translated row for row.

Times are relative to "now" (as the SQL uses datetime('now', ...)), so the
dashboard always has upcoming and recent meetings after a rebuild. Meeting 2
is the fully configured example (saved settings and two attachments) for
the Manage Meeting page; every other meeting uses the setting defaults.
"""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.types import utc_now
from app.models import (
    AttachmentKind,
    EncryptionMode,
    Meeting,
    MeetingAttachment,
    MeetingParticipant,
    MeetingStatus,
    MeetingType,
    NotesScope,
    ParticipantRole,
    ParticipantStatus,
    User,
)

# Without login, this user is the logged-in user in every browser.
DEFAULT_USER_ID = 1

# Fixed Personal Meeting IDs of the seed users, so a rebuilt database is reproducible.
SEED_PERSONAL_MEETING_IDS = {
    (1, "default.user@example.com"): "4827319051",
    (2, "priya.sharma@example.com"): "6382719045",
    (3, "arjun.mehta@example.com"): "7150462938",
}

# One client_token per browser: the same person keeps the same token.
DEFAULT_USER_TOKEN = "seed-browser-0001-default-user"
PRIYA_TOKEN = "seed-browser-0002-priya-sharma"
ARJUN_TOKEN = "seed-browser-0003-arjun-mehta"
GUEST_RAHUL_TOKEN = "seed-browser-0004-guest-rahul"


def seed_database(session: Session, now: datetime | None = None) -> bool:
    """Insert the seed rows into an empty database.

    Returns False without changing anything if any user already exists, so
    running it again is safe. The caller owns the transaction.
    """
    if session.scalar(select(User.id).limit(1)) is not None:
        return False

    now = now or utc_now()
    day = timedelta(days=1)
    minute = timedelta(minutes=1)
    created = {"created_at": now, "updated_at": now}

    pmi = SEED_PERSONAL_MEETING_IDS
    users = [
        User(id=DEFAULT_USER_ID, email="default.user@example.com", display_name="Default User",
             personal_meeting_id=pmi[DEFAULT_USER_ID, "default.user@example.com"], **created),
        User(id=2, email="priya.sharma@example.com", display_name="Priya Sharma",
             personal_meeting_id=pmi[2, "priya.sharma@example.com"], **created),
        User(id=3, email="arjun.mehta@example.com", display_name="Arjun Mehta",
             personal_meeting_id=pmi[3, "arjun.mehta@example.com"], **created),
    ]

    meetings = [
        # upcoming
        Meeting(
            id=1, meeting_code="85123456789", host_id=DEFAULT_USER_ID,
            title="Weekly Team Sync", description="Sprint progress and blockers",
            meeting_type=MeetingType.SCHEDULED, status=MeetingStatus.SCHEDULED,
            scheduled_start_at=now + day, duration_minutes=30, **created,
        ),
        # upcoming, fully configured
        Meeting(
            id=2, meeting_code="86234567890", host_id=DEFAULT_USER_ID,
            title="Design Review", description="Review the new dashboard mockups",
            meeting_type=MeetingType.SCHEDULED, status=MeetingStatus.SCHEDULED,
            scheduled_start_at=now + 3 * day, duration_minutes=60,
            passcode="Rv7@x2", waiting_room_enabled=True, encryption_mode=EncryptionMode.ENHANCED,
            notes_enabled=True, notes_scope=NotesScope.ALL_PARTICIPANTS,
            host_video_enabled=True, participant_video_enabled=False, template=None,
            **created,
        ),
        # recent
        Meeting(
            id=3, meeting_code="87345678901", host_id=DEFAULT_USER_ID,
            title="Project Kickoff", description="Scope and timeline",
            meeting_type=MeetingType.SCHEDULED, status=MeetingStatus.ENDED,
            scheduled_start_at=now - 2 * day, duration_minutes=45,
            started_at=now - 2 * day, ended_at=now - 2 * day + 42 * minute, **created,
        ),
        Meeting(
            id=4, meeting_code="88456789012", host_id=DEFAULT_USER_ID,
            title="Default User's Zoom Meeting", description=None,
            meeting_type=MeetingType.INSTANT, status=MeetingStatus.ENDED,
            started_at=now - day, ended_at=now - day + 18 * minute, **created,
        ),
        # hosted by someone else, attended by the default user
        Meeting(
            id=5, meeting_code="89567890123", host_id=2,
            title="Client Demo", description="Walkthrough for the client",
            meeting_type=MeetingType.SCHEDULED, status=MeetingStatus.ENDED,
            scheduled_start_at=now - 5 * day, duration_minutes=30,
            started_at=now - 5 * day, ended_at=now - 5 * day + 33 * minute, **created,
        ),
    ]

    host, participant, left = ParticipantRole.HOST, ParticipantRole.PARTICIPANT, ParticipantStatus.LEFT
    participants = [
        # (meeting_id, user_id, client_token, display_name, role, joined_at, left_at)
        (3, 1, DEFAULT_USER_TOKEN, "Default User", host, now - 2 * day, now - 2 * day + 42 * minute),
        (3, 2, PRIYA_TOKEN, "Priya Sharma", participant, now - 2 * day + 1 * minute, now - 2 * day + 42 * minute),
        (3, 3, ARJUN_TOKEN, "Arjun Mehta", participant, now - 2 * day + 3 * minute, now - 2 * day + 40 * minute),
        (4, 1, DEFAULT_USER_TOKEN, "Default User", host, now - day, now - day + 18 * minute),
        (4, None, GUEST_RAHUL_TOKEN, "Guest Rahul", participant, now - day + 2 * minute, now - day + 18 * minute),
        (5, 2, PRIYA_TOKEN, "Priya Sharma", host, now - 5 * day, now - 5 * day + 33 * minute),
        (5, 1, DEFAULT_USER_TOKEN, "Default User", participant, now - 5 * day + 1 * minute, now - 5 * day + 33 * minute),
    ]

    attachments = [
        MeetingAttachment(meeting_id=2, kind=AttachmentKind.WHITEBOARD, title="Dashboard wireframes", created_at=now),
        MeetingAttachment(meeting_id=2, kind=AttachmentKind.DOC, title="Design review agenda", created_at=now),
    ]

    session.add_all(users)
    session.add_all(meetings)
    session.add_all(
        MeetingParticipant(
            meeting_id=meeting_id, user_id=user_id, client_token=token, display_name=name,
            role=role, status=left, joined_at=joined_at, left_at=left_at,
        )
        for meeting_id, user_id, token, name, role, joined_at, left_at in participants
    )
    session.add_all(attachments)
    session.flush()
    return True
