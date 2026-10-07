"""Meetings: creation, editing, lookup, dashboard lists, lifecycle and host authorization.

Every function that writes runs as one transaction (see `atomic`): it
commits on success and rolls back completely on any error. State changes
use compare-and-set UPDATEs (`... WHERE status = 'scheduled'`), as in the
reference queries of schema_6.sql, so two concurrent requests cannot both
perform the same transition.

Results are views (app.services.views), never ORM rows. `get_meeting`
is the one exception: it returns the ORM row, including the passcode, for
use inside the service layer only.

Identity, given that there is no login yet:
  * user_id      - the account. User 1 in every browser, so it identifies
                   the meeting OWNER (meetings.host_id) but not a browser.
  * client_token - one browser. The active HOST is the joined participant
                   row with role = 'host' and that browser's token.
Owner actions (start, cancel, edit, attachments, viewing the passcode before
the meeting) check the account; in-meeting host controls (end, mute all,
remove) require the active host browser.
"""

import secrets
import string
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from functools import cache
from typing import Any
from zoneinfo import ZoneInfo, available_timezones

from sqlalchemy import Text, and_, case, cast, delete, exists, func, literal, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import atomic
from app.db.types import UTCTimestamp, utc_now
from app.models import (
    Meeting,
    MeetingAttachment,
    MeetingIdType,
    MeetingParticipant,
    MeetingStatus,
    MeetingType,
    ParticipantRole,
    ParticipantStatus,
    User,
)
from app.services import meeting_code as codes
from app.services.personal_meeting_id import PERSONAL_MEETING_ID_LENGTH
from app.services.exceptions import (
    InvalidMeetingInput,
    InvalidMeetingTransition,
    MeetingAlreadyEnded,
    MeetingAlreadyStarted,
    MeetingCodeUnavailable,
    MeetingNotFound,
    NotMeetingHost,
    UserNotFound,
)
from app.services.meeting_settings import (
    MeetingSettings,
    NewAttachment,
    clean_text,
    validate_attachments,
    validate_settings,
)
from app.services.views import MeetingDetails, MeetingSummary

MIN_DURATION_MINUTES = 1
MAX_DURATION_MINUTES = 1440
RECENT_MEETINGS_LIMIT = 10
MAX_CODE_ATTEMPTS = 5


# --- input validation ---------------------------------------------------------------


@cache
def _iana_timezones() -> frozenset[str]:
    return frozenset(available_timezones())


def _timezone(name: Any) -> ZoneInfo:
    # Exact IANA keys only: a case-insensitive filesystem would otherwise
    # accept "asia/kolkata" on Windows but not on Linux.
    if not isinstance(name, str) or name not in _iana_timezones():
        raise InvalidMeetingInput("timezone", f"{name!r} is not an IANA timezone name such as 'Asia/Kolkata'")
    return ZoneInfo(name)


def _local_to_utc(start: Any, zone: ZoneInfo) -> datetime:
    """Convert the planned start to UTC.

    A naive datetime is a wall-clock time in `zone`. Wall-clock times that a
    daylight-saving change skips or repeats are rejected instead of guessed.
    An aware datetime already names an exact instant and is converted as is.
    """
    if not isinstance(start, datetime):
        raise InvalidMeetingInput("scheduled_start", "must be a datetime")
    try:
        if start.tzinfo is not None and start.utcoffset() is not None:
            return start.astimezone(UTC).replace(microsecond=0)

        earlier = start.replace(tzinfo=zone, fold=0)
        later = start.replace(tzinfo=zone, fold=1)
        if earlier.utcoffset() != later.utcoffset():
            exists_once = earlier.astimezone(UTC).astimezone(zone).replace(tzinfo=None) == start
            problem = "occurs twice" if exists_once else "does not exist"
            raise InvalidMeetingInput(
                "scheduled_start",
                f"{start:%Y-%m-%d %H:%M} {problem} in {zone.key} because of a daylight-saving change",
            )
        return earlier.astimezone(UTC).replace(microsecond=0)
    except (OverflowError, ValueError) as error:
        raise InvalidMeetingInput("scheduled_start", "is outside the supported date range") from error


def _duration(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidMeetingInput("duration_minutes", "must be a whole number of minutes")
    if not MIN_DURATION_MINUTES <= value <= MAX_DURATION_MINUTES:
        raise InvalidMeetingInput(
            "duration_minutes", f"must be between {MIN_DURATION_MINUTES} and {MAX_DURATION_MINUTES}"
        )
    return value


def _meeting_id_type(value: Any) -> MeetingIdType:
    """The Schedule page's "Meeting ID" choice: generated (the meeting's own code) or personal (the host's PMI)."""
    try:
        return MeetingIdType(value)
    except ValueError:
        raise InvalidMeetingInput("meeting_id_type", "must be 'generated' or 'personal'") from None


def _schedule_fields(
    title: Any, description: Any, scheduled_start: Any, timezone: Any, duration_minutes: Any
) -> dict[str, Any]:
    """Validate the plan part of the scheduling form and return the column values."""
    title = clean_text(title, "title")
    description = clean_text(description, "description", required=False)
    zone = _timezone(timezone)
    return {
        "title": title,
        "description": description,
        "scheduled_start_at": _local_to_utc(scheduled_start, zone),
        "duration_minutes": _duration(duration_minutes),
        "timezone": zone.key,
    }


def _get_user(session: Session, user_id: Any) -> User:
    user = session.get(User, user_id) if isinstance(user_id, int) else None
    if user is None:
        raise UserNotFound(user_id)
    return user


# --- creation -------------------------------------------------------------------------


def _is_code_collision(error: IntegrityError) -> bool:
    return "UNIQUE constraint failed: meetings.meeting_code" in str(error.orig)


def _insert_with_unique_code(session: Session, build: Callable[[str], Meeting]) -> Meeting:
    """Insert a meeting under a fresh random code, retrying on the rare UNIQUE collision."""
    for _ in range(MAX_CODE_ATTEMPTS):
        meeting = build(codes.generate_meeting_code())
        session.add(meeting)
        try:
            session.commit()
        except IntegrityError as error:
            session.rollback()
            if _is_code_collision(error):
                continue
            raise
        except BaseException:
            session.rollback()
            raise
        return meeting
    raise MeetingCodeUnavailable(f"No unused meeting code found after {MAX_CODE_ATTEMPTS} attempts")


INSTANT_PASSCODE_LENGTH = 6
_INSTANT_PASSCODE_ALPHABET = string.ascii_letters + string.digits


def generate_instant_passcode() -> str:
    """A random, case-sensitive 6-character passcode of letters and digits, e.g. "57EcyB"."""
    return "".join(secrets.choice(_INSTANT_PASSCODE_ALPHABET) for _ in range(INSTANT_PASSCODE_LENGTH))


def create_instant_meeting(
    session: Session, *, host_id: int, title: str | None = None, settings: MeetingSettings | None = None
) -> MeetingDetails:
    """Create a meeting that is live immediately ("New meeting").

    Settings default to the schema's defaults, except that a meeting created
    without a passcode gets a random one (see generate_instant_passcode). Joining an
    instant meeting doesn't ask for it (see passcode_required in views.py).
    No participant row is created:
    the host's browser gets its host row when it joins with
    join_meeting(..., as_host=True).
    """
    host = _get_user(session, host_id)
    title = clean_text(title, "title", required=False) or f"{host.display_name}'s Zoom Meeting"
    setting_values = validate_settings(settings)
    if setting_values["passcode"] is None:
        setting_values["passcode"] = generate_instant_passcode()
    timezone, started_at = host.timezone, utc_now()

    meeting = _insert_with_unique_code(
        session,
        lambda code: Meeting(
            meeting_code=code,
            host_id=host_id,
            title=title,
            meeting_type=MeetingType.INSTANT,
            status=MeetingStatus.LIVE,
            scheduled_start_at=None,
            duration_minutes=None,
            timezone=timezone,
            started_at=started_at,
            ended_at=None,
            **setting_values,
        ),
    )
    return MeetingDetails.of(meeting, include_passcode=True)


def create_scheduled_meeting(
    session: Session,
    *,
    host_id: int,
    title: str,
    scheduled_start: datetime,
    timezone: str,
    duration_minutes: int,
    description: str | None = None,
    settings: MeetingSettings | None = None,
    attachments: Sequence[NewAttachment] = (),
    meeting_id_type: str = MeetingIdType.GENERATED,
) -> MeetingDetails:
    """Schedule a meeting with its settings and attachments, in one transaction.

    `scheduled_start` is the local wall-clock time in `timezone` (an IANA
    name); it is stored in UTC, and the timezone is kept for display.
    `meeting_id_type` "personal" makes people join with the host's Personal
    Meeting ID instead of the meeting's own generated code; the PMI itself is
    read from the user and never changed. The passcode is exactly the one
    given (None = no passcode): scheduled meetings never get a generated one.
    """
    plan = _schedule_fields(title, description, scheduled_start, timezone, duration_minutes)
    id_type = _meeting_id_type(meeting_id_type)
    setting_values = validate_settings(settings)
    new_attachments = validate_attachments(attachments)
    _get_user(session, host_id)

    meeting = _insert_with_unique_code(
        session,
        lambda code: Meeting(
            meeting_code=code,
            host_id=host_id,
            meeting_type=MeetingType.SCHEDULED,
            status=MeetingStatus.SCHEDULED,
            meeting_id_type=id_type,
            started_at=None,
            ended_at=None,
            attachments=[MeetingAttachment(kind=kind, title=name) for kind, name in new_attachments],
            **plan,
            **setting_values,
        ),
    )
    return MeetingDetails.of(meeting, include_passcode=True)


# --- lookups and dashboard lists ---------------------------------------------------------


def get_meeting(session: Session, meeting_code: str) -> Meeting:
    """Look a meeting up by its public code (spaces and dashes are ignored).

    Internal to the service layer: the ORM row includes the passcode. Callers
    outside app.services use get_public_meeting or get_meeting_details.
    """
    code = codes.normalize_meeting_code(meeting_code) if isinstance(meeting_code, str) else str(meeting_code)
    meeting = session.scalar(select(Meeting).where(Meeting.meeting_code == code))
    if meeting is None:
        raise MeetingNotFound(code)
    return meeting


def resolve_meeting(session: Session, meeting_id: str) -> Meeting:
    """The meeting that a joiner's ID names: an 11-digit meeting code, or a 10-digit Personal Meeting ID.

    A PMI is shared by all of its owner's personal meetings, as in Zoom: it
    names the owner's live personal meeting, else the next one that has not
    finished (the Upcoming list's rule), else nothing. Internal like get_meeting.
    """
    normalized = codes.normalize_meeting_code(meeting_id) if isinstance(meeting_id, str) else str(meeting_id)
    if len(normalized) != PERSONAL_MEETING_ID_LENGTH or not normalized.isdigit():
        return get_meeting(session, normalized)
    planned_end = func.datetime(
        Meeting.scheduled_start_at, "+" + cast(Meeting.duration_minutes, Text) + " minutes"
    )
    meeting = session.scalar(
        select(Meeting)
        .join(User, User.id == Meeting.host_id)
        .where(
            User.personal_meeting_id == normalized,
            Meeting.meeting_id_type == MeetingIdType.PERSONAL,
            or_(
                Meeting.status == MeetingStatus.LIVE,
                and_(Meeting.status == MeetingStatus.SCHEDULED, planned_end >= literal(utc_now(), UTCTimestamp())),
            ),
        )
        .order_by(case((Meeting.status == MeetingStatus.LIVE, 0), else_=1), Meeting.scheduled_start_at, Meeting.id)
        .limit(1)
    )
    if meeting is None:
        raise MeetingNotFound(normalized)
    return meeting


def get_public_meeting(session: Session, meeting_id: str) -> MeetingSummary:
    """What anyone holding the meeting ID (a code or a PMI) may see: the join page. Never includes the passcode."""
    return MeetingSummary.of(resolve_meeting(session, meeting_id))


def get_meeting_details(
    session: Session, meeting_code: str, *, user_id: int | None = None, client_token: str | None = None
) -> MeetingDetails:
    """Everything the Manage Meeting page needs, including attachments.

    The passcode is included only for the owner's account (user_id equals
    meetings.host_id, which without login is user 1 in every browser) or the
    meeting's active host browser; for anyone else it is None.
    """
    meeting = get_meeting(session, meeting_code)
    return MeetingDetails.of(meeting, include_passcode=_may_see_passcode(session, meeting, user_id, client_token))


def _summaries(session: Session, statement: Any) -> list[MeetingSummary]:
    return [MeetingSummary.of(meeting) for meeting in session.scalars(statement)]


def list_upcoming_meetings(session: Session, user_id: int, *, now: datetime | None = None) -> list[MeetingSummary]:
    """The dashboard's Upcoming list, as defined in schema_6.sql.

    Meetings the user hosts that are live, or scheduled and whose planned end
    (start + duration) has not passed. Live meetings first, then by time.
    """
    now = now or utc_now()
    planned_end = func.datetime(
        Meeting.scheduled_start_at, "+" + cast(Meeting.duration_minutes, Text) + " minutes"
    )
    statement = (
        select(Meeting)
        .where(
            Meeting.host_id == user_id,
            or_(
                Meeting.status == MeetingStatus.LIVE,
                and_(Meeting.status == MeetingStatus.SCHEDULED, planned_end >= literal(now, UTCTimestamp())),
            ),
        )
        .order_by(
            case((Meeting.status == MeetingStatus.LIVE, 0), else_=1),
            func.coalesce(Meeting.scheduled_start_at, Meeting.started_at),
            Meeting.id,
        )
    )
    return _summaries(session, statement)


def list_recent_meetings(
    session: Session, user_id: int, *, limit: int = RECENT_MEETINGS_LIMIT
) -> list[MeetingSummary]:
    """The dashboard's Recent list: ended meetings the user hosted or attended, newest first."""
    attended = exists().where(
        MeetingParticipant.meeting_id == Meeting.id, MeetingParticipant.user_id == user_id
    )
    statement = (
        select(Meeting)
        .where(Meeting.status == MeetingStatus.ENDED, or_(Meeting.host_id == user_id, attended))
        .order_by(Meeting.ended_at.desc(), Meeting.id.desc())
        .limit(limit)
    )
    return _summaries(session, statement)


# --- authorization ------------------------------------------------------------------------


def require_owner(meeting: Meeting, user_id: int | None, action: str) -> None:
    """The caller's account must own the meeting (before anyone is in the room)."""
    if user_id is None or user_id != meeting.host_id:
        raise NotMeetingHost(f"Only the account that owns this meeting can {action} it")


def require_host(session: Session, meeting: Meeting, client_token: str) -> MeetingParticipant:
    """Return the caller's participant row if this browser is the meeting's active host.

    Checks the browser (client_token, joined, role = 'host'), never the
    account: without login every browser is user 1. The host role is only
    ever granted by join_meeting(..., as_host=True) to the owner's account or
    by the current host through make_host, so holding it is the proof.
    """
    host = session.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.client_token == client_token,
            MeetingParticipant.status == ParticipantStatus.JOINED,
            MeetingParticipant.role == ParticipantRole.HOST,
        )
    )
    if host is None:
        raise NotMeetingHost("Only the meeting's host can do this")
    return host


def is_meeting_host(session: Session, meeting_code: str, client_token: str) -> bool:
    try:
        require_host(session, get_meeting(session, meeting_code), client_token)
    except NotMeetingHost:
        return False
    return True


def _may_see_passcode(session: Session, meeting: Meeting, user_id: int | None, client_token: str | None) -> bool:
    if user_id is not None and user_id == meeting.host_id:
        return True
    if isinstance(client_token, str):
        try:
            require_host(session, meeting, client_token)
        except NotMeetingHost:
            return False
        return True
    return False


# --- lifecycle ---------------------------------------------------------------------------


def _compare_and_set(session: Session, meeting: Meeting, expected: MeetingStatus, **values: Any) -> None:
    """Apply `values` only if the meeting is still in `expected` state."""
    result = session.execute(
        update(Meeting).where(Meeting.id == meeting.id, Meeting.status == expected).values(**values),
        execution_options={"synchronize_session": False},
    )
    session.expire(meeting)
    if result.rowcount != 1:
        raise InvalidMeetingTransition(
            meeting.meeting_code, meeting.status, "change", "The meeting changed state concurrently"
        )


def close_meeting(session: Session, meeting: Meeting, status: MeetingStatus, now: datetime) -> None:
    """End a live meeting or cancel a scheduled one, checking everyone out (room and waiting room).

    A building block for the service functions: it neither authorizes nor
    commits, and must run inside the caller's transaction (schema_6.sql:
    "both statements in ONE transaction").
    """
    session.execute(
        update(MeetingParticipant)
        .where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.status.in_((ParticipantStatus.WAITING, ParticipantStatus.JOINED)),
        )
        .values(status=ParticipantStatus.LEFT, left_at=now),
        execution_options={"synchronize_session": False},
    )
    session.expire_all()
    if status == MeetingStatus.ENDED:
        _compare_and_set(session, meeting, MeetingStatus.LIVE, status=MeetingStatus.ENDED, ended_at=now)
    else:
        _compare_and_set(session, meeting, MeetingStatus.SCHEDULED, status=MeetingStatus.CANCELLED)


def start_meeting(session: Session, meeting_code: str, *, user_id: int) -> MeetingDetails:
    """scheduled -> live. Only the owner's account may start a meeting.

    The starting browser then claims the host role with
    join_meeting(..., as_host=True).
    """
    meeting = get_meeting(session, meeting_code)
    code, status = meeting.meeting_code, meeting.status
    if meeting.meeting_type == MeetingType.INSTANT:
        raise InvalidMeetingTransition(code, status, "start", "Instant meetings are live as soon as they are created")
    if status == MeetingStatus.LIVE:
        raise MeetingAlreadyStarted(code, status, "start")
    if status == MeetingStatus.ENDED:
        raise MeetingAlreadyEnded(code, status, "start")
    if status != MeetingStatus.SCHEDULED:
        raise InvalidMeetingTransition(code, status, "start")
    require_owner(meeting, user_id, "start")

    try:
        with atomic(session):
            _compare_and_set(
                session, meeting, MeetingStatus.SCHEDULED,
                status=MeetingStatus.LIVE, started_at=utc_now(), ended_at=None,
            )
    except IntegrityError as error:
        # uq_meetings_one_live_personal_per_host: SQLite names its column, not the index.
        if "UNIQUE constraint failed: meetings.host_id" not in str(error.orig):
            raise
        raise InvalidMeetingTransition(
            code, status, "start", "Another meeting on your Personal Meeting ID is already live"
        ) from None
    return MeetingDetails.of(meeting, include_passcode=True)


def end_meeting(session: Session, meeting_code: str, *, client_token: str) -> MeetingDetails:
    """live -> ended, checking every joined participant out. Only the active host browser may end it."""
    meeting = get_meeting(session, meeting_code)
    code, status = meeting.meeting_code, meeting.status
    if status == MeetingStatus.ENDED:
        raise MeetingAlreadyEnded(code, status, "end")
    if status != MeetingStatus.LIVE:
        raise InvalidMeetingTransition(code, status, "end")

    with atomic(session):
        require_host(session, meeting, client_token)
        close_meeting(session, meeting, MeetingStatus.ENDED, utc_now())
    return MeetingDetails.of(meeting, include_passcode=True)


def cancel_meeting(session: Session, meeting_code: str, *, user_id: int) -> MeetingDetails:
    """scheduled -> cancelled: the soft delete behind "Delete" on an upcoming meeting (owner only).

    The row and its history are kept; a cancelled meeting cannot be started.
    """
    meeting = get_meeting(session, meeting_code)
    code, status = meeting.meeting_code, meeting.status
    if status == MeetingStatus.ENDED:
        raise MeetingAlreadyEnded(code, status, "cancel")
    if status != MeetingStatus.SCHEDULED:
        raise InvalidMeetingTransition(code, status, "cancel")
    require_owner(meeting, user_id, "cancel")

    with atomic(session):
        close_meeting(session, meeting, MeetingStatus.CANCELLED, utc_now())
    return MeetingDetails.of(meeting, include_passcode=True)


def delete_meeting(session: Session, meeting_code: str, *, user_id: int) -> None:
    """Delete a meeting's row for good (owner only), unless it is in progress.

    Upcoming, cancelled and ended meetings can all be deleted; a live meeting
    cannot (MeetingAlreadyStarted) until it has ended. Unlike cancel_meeting,
    nothing is kept: the database deletes its attachments and participant
    history with it (ON DELETE CASCADE). The host's user row and PMI are untouched.
    """
    meeting = get_meeting(session, meeting_code)
    if meeting.status == MeetingStatus.LIVE:
        raise MeetingAlreadyStarted(meeting.meeting_code, meeting.status, "delete")
    require_owner(meeting, user_id, "delete")

    with atomic(session):
        result = session.execute(
            delete(Meeting).where(Meeting.id == meeting.id, Meeting.status != MeetingStatus.LIVE),
            execution_options={"synchronize_session": False},
        )
        if result.rowcount != 1:  # it was started meanwhile
            raise MeetingAlreadyStarted(meeting.meeting_code, MeetingStatus.LIVE, "delete")
    session.expunge(meeting)


# --- editing before the meeting starts ------------------------------------------------------


def require_editable(meeting: Meeting, action: str = "edit") -> None:
    """Only a scheduled meeting that has not started may be changed."""
    code, status = meeting.meeting_code, meeting.status
    if status == MeetingStatus.SCHEDULED:
        return
    if status == MeetingStatus.LIVE:
        raise MeetingAlreadyStarted(code, status, action)
    if status == MeetingStatus.ENDED:
        raise MeetingAlreadyEnded(code, status, action)
    raise InvalidMeetingTransition(code, status, action)


def _replace_attachments(session: Session, meeting: Meeting, wanted: list[tuple[str, str]]) -> None:
    """Make the meeting's attachments equal `wanted`, keeping rows that are unchanged."""
    remaining = list(wanted)
    for attachment in list(meeting.attachments):
        key = (attachment.kind, attachment.title)
        if key in remaining:
            remaining.remove(key)
        else:
            meeting.attachments.remove(attachment)  # delete-orphan deletes the row
    meeting.attachments.extend(MeetingAttachment(kind=kind, title=title) for kind, title in remaining)
    session.flush()


def update_scheduled_meeting(
    session: Session,
    meeting_code: str,
    *,
    user_id: int,
    title: str,
    scheduled_start: datetime,
    timezone: str,
    duration_minutes: int,
    settings: MeetingSettings,
    description: str | None = None,
    attachments: Sequence[NewAttachment] | None = None,
    meeting_id_type: str | None = None,
) -> MeetingDetails:
    """Save the Edit Meeting form: replaces the plan and all settings (owner only).

    Allowed only while the meeting is scheduled. `attachments` replaces the
    meeting's attachments when given (rows that stay are kept as they are);
    None leaves them unchanged. `meeting_id_type` switches between the
    meeting's own code and the host's PMI (None keeps it); the meeting_code
    and the PMI themselves never change. updated_at is refreshed by the ORM.
    """
    plan = _schedule_fields(title, description, scheduled_start, timezone, duration_minutes)
    if settings is None:
        raise InvalidMeetingInput("settings", "are required; pass the meeting's complete settings")
    setting_values = validate_settings(settings)
    new_attachments = None if attachments is None else validate_attachments(attachments)
    id_type = {} if meeting_id_type is None else {"meeting_id_type": _meeting_id_type(meeting_id_type)}

    meeting = get_meeting(session, meeting_code)
    require_editable(meeting)
    require_owner(meeting, user_id, "edit")

    with atomic(session):
        _compare_and_set(session, meeting, MeetingStatus.SCHEDULED, **plan, **setting_values, **id_type)
        if new_attachments is not None:
            _replace_attachments(session, meeting, new_attachments)
    return MeetingDetails.of(meeting, include_passcode=True)
