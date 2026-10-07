"""Participants: join, the waiting room, leave, and the host controls.

A browser is identified by its client_token, never by user_id: without
login every browser is user 1. One row is written per join, so leaving and
rejoining keeps the attendance history; rows are never deleted.

When the meeting has waiting_room_enabled, everyone but the host joins as
'waiting' and is not in the room (not on the roster of other participants,
not counted as joined) until the host admits them. Host controls - admit,
send to the waiting room, remove, rename, make host, mute all - are checked
here against the caller's browser being the active host (require_host),
never against anything the client claims.
"""

import hmac
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import atomic
from app.db.types import utc_now
from app.models import Meeting, MeetingParticipant, MeetingStatus, ParticipantRole, ParticipantStatus, User
from app.services.exceptions import (
    InvalidMeetingInput,
    InvalidPasscode,
    InvalidParticipantTransition,
    MeetingNotJoinable,
    MeetingNotLive,
    NotMeetingHost,
    NotMeetingParticipant,
    ParticipantNotFound,
    ParticipantRemoved,
    UserNotFound,
)
from app.services.meeting_service import close_meeting, get_meeting, require_host, resolve_meeting
from app.services.meeting_settings import clean_text
from app.services.time_limit import PRESENCE_TIMEOUT, meeting_ends_at
from app.services.views import ParticipantView, passcode_required

MIN_CLIENT_TOKEN_LENGTH = 16
JOINABLE_STATUSES = (MeetingStatus.SCHEDULED, MeetingStatus.LIVE)
# Waiting in the waiting room or in the room: the browser's current row, at most one.
PRESENT = (ParticipantStatus.WAITING, ParticipantStatus.JOINED)


@dataclass(frozen=True)
class JoinResult:
    participant: ParticipantView  # never includes the client_token
    # True when this browser was already in the room (page refresh or retry) and its row was reused.
    reused: bool


@dataclass(frozen=True)
class LeaveResult:
    # False when the browser had already left or been removed (leaving again is a no-op).
    left: bool
    # True when this was the last participant of a live meeting, which therefore ended.
    meeting_ended: bool


def _client_token(value: Any) -> str:
    if not isinstance(value, str) or len(value) < MIN_CLIENT_TOKEN_LENGTH:
        raise InvalidMeetingInput("client_token", f"must be a string of at least {MIN_CLIENT_TOKEN_LENGTH} characters")
    return value


def _active_participant(session: Session, meeting_id: int, client_token: str) -> MeetingParticipant | None:
    return session.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.client_token == client_token,
            MeetingParticipant.status == ParticipantStatus.JOINED,
        )
    )


def _present_row(session: Session, meeting_id: int, client_token: str) -> MeetingParticipant | None:
    """The browser's waiting or joined row, if it has one."""
    return session.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.client_token == client_token,
            MeetingParticipant.status.in_(PRESENT),
        )
    )


def _active_host(session: Session, meeting_id: int) -> MeetingParticipant | None:
    return session.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.status == ParticipantStatus.JOINED,
            MeetingParticipant.role == ParticipantRole.HOST,
        )
    )


def _has_status(session: Session, meeting_id: int, client_token: str, *statuses: ParticipantStatus) -> bool:
    return (
        session.scalar(
            select(MeetingParticipant.id)
            .where(
                MeetingParticipant.meeting_id == meeting_id,
                MeetingParticipant.client_token == client_token,
                MeetingParticipant.status.in_(statuses),
            )
            .limit(1)
        )
        is not None
    )


def _check_passcode(meeting: Meeting, supplied: Any) -> None:
    """A scheduled meeting with a passcode needs the exact passcode (compared in constant time).

    An instant meeting's passcode is not asked for: anyone with the link or the Meeting ID joins.
    """
    if not passcode_required(meeting):
        return
    # Passcodes cannot contain whitespace, so trimming pasted input is safe.
    supplied = supplied.strip() if isinstance(supplied, str) else None
    if not supplied:
        raise InvalidPasscode("missing")
    if not hmac.compare_digest(supplied.encode(), meeting.passcode.encode()):
        raise InvalidPasscode("incorrect")


def _require_live(meeting: Meeting) -> None:
    if meeting.status != MeetingStatus.LIVE:
        raise MeetingNotLive(meeting.meeting_code, meeting.status)


# --- join ----------------------------------------------------------------------------------


def _join_once(
    session: Session,
    meeting_code: str,
    client_token: str,
    display_name: str,
    user_id: int | None,
    as_host: bool,
    passcode: str | None,
) -> JoinResult:
    # 1. The meeting exists and can be joined (by its code, or by its host's PMI).
    meeting = resolve_meeting(session, meeting_code)
    if meeting.status not in JOINABLE_STATUSES:
        raise MeetingNotJoinable(meeting.meeting_code, meeting.status)

    # 2. The passcode, if joining needs one (a scheduled meeting's; every browser, the host's too).
    _check_passcode(meeting, passcode)

    # 3. A browser the host removed may not come back.
    if _has_status(session, meeting.id, client_token, ParticipantStatus.REMOVED):
        raise ParticipantRemoved("This browser was removed from the meeting by the host")

    # The host role goes to the owner's account, in a live meeting, when no host is in the room.
    if as_host:
        if user_id is None or user_id != meeting.host_id:
            raise NotMeetingHost("Only the account that owns this meeting can join as its host")
        _require_live(meeting)
    active_host = _active_host(session, meeting.id) if as_host else None
    takes_host_role = as_host and active_host is None

    # 4. Already waiting or in the room (page refresh)? Reuse that row instead of adding a duplicate.
    existing = _present_row(session, meeting.id, client_token)
    if existing is not None:
        existing.last_seen_at = utc_now()
        if takes_host_role and existing.role == ParticipantRole.PARTICIPANT:
            existing.role = ParticipantRole.HOST  # e.g. waited in a scheduled meeting, then started it
            if existing.status == ParticipantStatus.WAITING:
                existing.status, existing.joined_at = ParticipantStatus.JOINED, utc_now()
            session.flush()
        return JoinResult(ParticipantView.of(existing), reused=True)

    # The owner coming back (a new row, not a refresh) reclaims the host role, as
    # in Zoom, from whoever it was handed to automatically when they left. A host
    # that is another of the owner's own browsers keeps it.
    if as_host and active_host is not None and active_host.user_id != meeting.host_id:
        active_host.role = ParticipantRole.PARTICIPANT
        session.flush()  # demote before the new host row is inserted (one host at a time)
        takes_host_role = True

    # 5. Otherwise join with a new row. With a waiting room, everyone but the
    #    host waits to be admitted. Video starts on or off as the meeting's
    #    host / participant video setting says (state only; no media here).
    role = ParticipantRole.HOST if takes_host_role else ParticipantRole.PARTICIPANT
    waits = meeting.waiting_room_enabled and not takes_host_role
    participant = MeetingParticipant(
        meeting_id=meeting.id,
        user_id=user_id,
        client_token=client_token,
        display_name=display_name,
        role=role,
        status=ParticipantStatus.WAITING if waits else ParticipantStatus.JOINED,
        is_video_on=meeting.host_video_enabled if takes_host_role else meeting.participant_video_enabled,
        joined_at=utc_now(),
    )
    session.add(participant)
    session.flush()
    return JoinResult(ParticipantView.of(participant), reused=False)


def _is_participant_uniqueness_conflict(error: IntegrityError) -> bool:
    # uq_participants_one_active_per_client or uq_participants_one_active_host
    return "UNIQUE constraint failed: meeting_participants." in str(error.orig)


def join_meeting(
    session: Session,
    meeting_code: str,
    *,
    client_token: str,
    display_name: str,
    user_id: int | None = None,
    as_host: bool = False,
    passcode: str | None = None,
) -> JoinResult:
    """Put a browser in a meeting, following the join flow of schema_6.sql.

    `user_id` is None for a guest. `as_host` is set by the owner's browser
    after creating or starting the meeting; it receives the host role only
    if no host is already in the room, and joins as a participant otherwise.
    With waiting_room_enabled, a participant's row is 'waiting' until the
    host admits them. Calling it again (a refresh) returns the same row.
    """
    client_token = _client_token(client_token)
    display_name = clean_text(display_name, "display_name")
    if user_id is not None and session.get(User, user_id) is None:
        raise UserNotFound(user_id)
    refresh_meeting(session, resolve_meeting(session, meeting_code))  # a meeting past its time limit is not joinable

    try:
        with atomic(session):
            return _join_once(session, meeting_code, client_token, display_name, user_id, as_host, passcode)
    except IntegrityError as error:
        if not _is_participant_uniqueness_conflict(error):
            raise
    # A concurrent request (the same browser retrying, or another browser taking
    # the host role) committed between our checks and our insert. The partial
    # unique indexes stopped a duplicate; re-running the checks now sees that row.
    with atomic(session):
        return _join_once(session, meeting_code, client_token, display_name, user_id, as_host, passcode)


# --- roster ----------------------------------------------------------------------------------


def list_participants(session: Session, meeting_code: str, *, client_token: str) -> list[ParticipantView]:
    """Who is in the room now (joined rows, in joining order); the host also gets the waiting room.

    Only a browser that is itself in the room may see the roster, so the
    meeting code alone (without the passcode) does not reveal attendees, and
    someone in the waiting room sees nobody.
    """
    client_token = _client_token(client_token)
    meeting = get_meeting(session, meeting_code)
    refresh_meeting(session, meeting)
    caller = _active_participant(session, meeting.id, client_token)
    if caller is None:
        raise NotMeetingParticipant("Only participants in the meeting can see who is in it")
    visible = PRESENT if caller.role == ParticipantRole.HOST else (ParticipantStatus.JOINED,)
    rows = session.scalars(
        select(MeetingParticipant)
        .where(MeetingParticipant.meeting_id == meeting.id, MeetingParticipant.status.in_(visible))
        .order_by(MeetingParticipant.joined_at, MeetingParticipant.id)
    )
    return [ParticipantView.of(row) for row in rows]


def get_own_participant(session: Session, meeting_code: str, *, client_token: str) -> ParticipantView:
    """This browser's row: 'waiting' until admitted, then 'joined' (what the room polls every few seconds).

    Each call is this browser's check-in (last_seen_at). It then applies the
    meeting's time limit and checks out browsers that went silent, so a
    meeting that has ended, by its host or by its time limit, shows as such.
    Raises ParticipantRemoved once the host has removed this browser, and
    ParticipantNotFound when it is not waiting or in the room.
    """
    client_token = _client_token(client_token)
    meeting = get_meeting(session, meeting_code)
    with atomic(session):
        session.execute(
            update(MeetingParticipant)
            .where(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.client_token == client_token,
                MeetingParticipant.status.in_(PRESENT),
            )
            .values(last_seen_at=utc_now()),
            execution_options={"synchronize_session": False},
        )
        session.expire_all()
    refresh_meeting(session, meeting)
    row = _present_row(session, meeting.id, client_token)
    if row is not None:
        return ParticipantView.of(row)
    if _has_status(session, meeting.id, client_token, ParticipantStatus.REMOVED):
        raise ParticipantRemoved("This browser was removed from the meeting by the host")
    raise ParticipantNotFound("This browser is not in the meeting")


# --- leave ---------------------------------------------------------------------------------


def leave_meeting(session: Session, meeting_code: str, *, client_token: str) -> LeaveResult:
    """joined or waiting -> left for this browser. Safe to repeat.

    History rows are never changed. As schema_6.sql requires, when the last
    participant of a live meeting leaves the room, the meeting ends in the
    same transaction (checking out anyone still waiting); otherwise it would
    stay 'live' forever. Leaving the waiting room never ends the meeting.
    When the host leaves and others are still in the room, the host role
    passes automatically to whoever has been in the room longest, in the same
    transaction, so the meeting is never left without a host.
    """
    client_token = _client_token(client_token)
    meeting = get_meeting(session, meeting_code)

    with atomic(session):
        result = _check_out(session, meeting, client_token, utc_now())
        if result is None:
            if not _has_status(session, meeting.id, client_token, ParticipantStatus.LEFT, ParticipantStatus.REMOVED):
                raise ParticipantNotFound("This browser has not joined the meeting")
            return LeaveResult(left=False, meeting_ended=False)
        return result


def _check_out(session: Session, meeting: Meeting, client_token: str, now: datetime) -> LeaveResult | None:
    """Leave for one browser inside the caller's transaction; None if it was not waiting or in the room."""
    current = _present_row(session, meeting.id, client_token)
    was_in_room = current is not None and current.status == ParticipantStatus.JOINED
    was_host = was_in_room and current.role == ParticipantRole.HOST
    result = session.execute(
        update(MeetingParticipant)
        .where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.client_token == client_token,
            MeetingParticipant.status.in_(PRESENT),
        )
        .values(status=ParticipantStatus.LEFT, left_at=now),
        execution_options={"synchronize_session": False},
    )
    session.expire_all()
    if result.rowcount == 0:
        return None

    still_joined = session.scalar(
        select(func.count())
        .select_from(MeetingParticipant)
        .where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.status == ParticipantStatus.JOINED,
        )
    )
    if was_in_room and still_joined == 0 and meeting.status == MeetingStatus.LIVE:
        close_meeting(session, meeting, MeetingStatus.ENDED, now)
        return LeaveResult(left=True, meeting_ended=True)
    if was_host and still_joined > 0:
        _hand_over_host(session, meeting)
    return LeaveResult(left=True, meeting_ended=False)


def _hand_over_host(session: Session, meeting: Meeting) -> None:
    """Make the longest-present joined participant the host (the leaving host's row is already 'left')."""
    successor = session.scalar(
        select(MeetingParticipant)
        .where(MeetingParticipant.meeting_id == meeting.id, MeetingParticipant.status == ParticipantStatus.JOINED)
        .order_by(MeetingParticipant.joined_at, MeetingParticipant.id)
        .limit(1)
    )
    if successor is not None:
        successor.role = ParticipantRole.HOST
        session.flush()


# --- time limit and silent browsers ---------------------------------------------------------


def refresh_meeting(session: Session, meeting: Meeting, *, now: datetime | None = None) -> None:
    """Apply what time does to a live meeting (time_limit.py), in one transaction.

    At its time limit the meeting ends for everyone. Otherwise every browser
    that is waiting or in the room but has not checked in for PRESENCE_TIMEOUT
    is checked out exactly like Leave: the host role passes on, and the last
    one out of the room ends the meeting. Called by the requests that read or
    change a meeting's room, so no background job is needed.
    """
    if meeting.status != MeetingStatus.LIVE:
        return
    now = now or utc_now()
    with atomic(session):
        ends_at = meeting_ends_at(meeting)
        if ends_at is not None and now >= ends_at:
            # Ended at the limit, not whenever someone next looked; never before a row's joined_at.
            latest_join = session.scalar(
                select(func.max(MeetingParticipant.joined_at)).where(
                    MeetingParticipant.meeting_id == meeting.id, MeetingParticipant.status.in_(PRESENT)
                )
            )
            close_meeting(session, meeting, MeetingStatus.ENDED, max(ends_at, latest_join or ends_at))
            return
        silent = session.scalars(
            select(MeetingParticipant.client_token)
            .where(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.status.in_(PRESENT),
                MeetingParticipant.last_seen_at < now - PRESENCE_TIMEOUT,
            )
            .order_by(MeetingParticipant.joined_at, MeetingParticipant.id)
        ).all()
        for client_token in silent:
            _check_out(session, meeting, client_token, now)
            if meeting.status != MeetingStatus.LIVE:
                break


def refresh_live_meetings(session: Session) -> None:
    """refresh_meeting for every live meeting (before the dashboard lists and meeting lookups)."""
    now = utc_now()
    for meeting in session.scalars(select(Meeting).where(Meeting.status == MeetingStatus.LIVE)).all():
        refresh_meeting(session, meeting, now=now)


# --- host controls -------------------------------------------------------------------------


def mute_all(session: Session, meeting_code: str, *, client_token: str) -> int:
    """Mute every participant currently in the room except the host. Returns how many rows were updated."""
    meeting = get_meeting(session, meeting_code)
    _require_live(meeting)

    with atomic(session):
        require_host(session, meeting, client_token)
        result = session.execute(
            update(MeetingParticipant)
            .where(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.status == ParticipantStatus.JOINED,
                MeetingParticipant.role != ParticipantRole.HOST,
            )
            .values(is_muted=True),
            execution_options={"synchronize_session": False},
        )
        session.expire_all()
        return result.rowcount


def _target(session: Session, meeting: Meeting, participant_id: Any) -> MeetingParticipant:
    target = session.get(MeetingParticipant, participant_id) if isinstance(participant_id, int) else None
    if target is None or target.meeting_id != meeting.id:
        raise ParticipantNotFound("No such participant in this meeting")
    return target


def _set_state(session: Session, target: MeetingParticipant, expected: tuple[str, ...], **values: Any) -> None:
    """Apply `values` only if the target is still in one of the `expected` states (compare-and-set)."""
    result = session.execute(
        update(MeetingParticipant)
        .where(MeetingParticipant.id == target.id, MeetingParticipant.status.in_(expected))
        .values(**values),
        execution_options={"synchronize_session": False},
    )
    session.expire(target)
    if result.rowcount != 1:
        raise InvalidParticipantTransition("The participant changed state concurrently; refresh and try again")


def remove_participant(
    session: Session, meeting_code: str, *, client_token: str, participant_id: int
) -> ParticipantView:
    """Remove a participant who is waiting or in the room (-> removed). The row is kept.

    The database does not stop a removed browser from rejoining; join_meeting
    does, by checking for a 'removed' row with the same client_token.
    """
    meeting = get_meeting(session, meeting_code)
    _require_live(meeting)

    with atomic(session):
        host = require_host(session, meeting, client_token)
        target = _target(session, meeting, participant_id)
        if target.id == host.id:
            raise InvalidMeetingInput("participant_id", "the host cannot remove themselves; leave or end the meeting")

        result = session.execute(
            update(MeetingParticipant)
            .where(
                MeetingParticipant.id == target.id,
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.status.in_(PRESENT),
            )
            .values(status=ParticipantStatus.REMOVED, left_at=utc_now()),
            execution_options={"synchronize_session": False},
        )
        session.expire(target)
        if result.rowcount != 1:
            raise ParticipantNotFound("The participant is no longer in the meeting")
        return ParticipantView.of(target)


def admit_participant(
    session: Session, meeting_code: str, *, client_token: str, participant_id: int
) -> ParticipantView:
    """Let someone in from the waiting room (waiting -> joined). Active host browser only."""
    meeting = get_meeting(session, meeting_code)
    _require_live(meeting)

    with atomic(session):
        require_host(session, meeting, client_token)
        target = _target(session, meeting, participant_id)
        if target.status != ParticipantStatus.WAITING:
            raise InvalidParticipantTransition(f"Only someone in the waiting room can be admitted (they are {target.status})")
        _set_state(session, target, (ParticipantStatus.WAITING,), status=ParticipantStatus.JOINED, joined_at=utc_now())
        return ParticipantView.of(target)


def move_to_waiting_room(
    session: Session, meeting_code: str, *, client_token: str, participant_id: int
) -> ParticipantView:
    """Send someone in the room back to the waiting room (joined -> waiting). Active host browser only.

    Works whether or not the meeting's waiting room is enabled, as in Zoom.
    The host cannot send themselves.
    """
    meeting = get_meeting(session, meeting_code)
    _require_live(meeting)

    with atomic(session):
        host = require_host(session, meeting, client_token)
        target = _target(session, meeting, participant_id)
        if target.id == host.id or target.role == ParticipantRole.HOST:
            raise InvalidParticipantTransition("The host cannot be put in the waiting room")
        if target.status != ParticipantStatus.JOINED:
            raise InvalidParticipantTransition(
                f"Only someone in the meeting can be put in the waiting room (they are {target.status})"
            )
        _set_state(session, target, (ParticipantStatus.JOINED,), status=ParticipantStatus.WAITING, joined_at=utc_now())
        return ParticipantView.of(target)


def rename_participant(
    session: Session, meeting_code: str, *, client_token: str, participant_id: int, display_name: str
) -> ParticipantView:
    """Change the name shown for someone waiting or in the room.

    Anyone present may rename themselves; renaming someone else needs the
    active host browser. Only the meeting row changes, never users.display_name.
    """
    client_token = _client_token(client_token)
    display_name = clean_text(display_name, "display_name")
    meeting = get_meeting(session, meeting_code)

    with atomic(session):
        caller = _present_row(session, meeting.id, client_token)
        if caller is None:
            raise NotMeetingParticipant("Only participants in the meeting can rename")
        target = _target(session, meeting, participant_id)
        if target.id != caller.id:
            require_host(session, meeting, client_token)
        if target.status not in PRESENT:
            raise InvalidParticipantTransition(f"Only someone waiting or in the meeting can be renamed (they are {target.status})")
        _set_state(session, target, PRESENT, display_name=display_name)
        return ParticipantView.of(target)


def make_host(session: Session, meeting_code: str, *, client_token: str, participant_id: int) -> ParticipantView:
    """Hand the host role to someone in the room; the current host becomes a participant.

    One transaction, demoting before promoting, so the meeting never has two
    hosts (uq_participants_one_active_host would refuse it anyway). The new
    host must be joined: not waiting, left or removed. Account roles are not
    touched: this is the meeting's host, not the meeting's owner.
    """
    meeting = get_meeting(session, meeting_code)
    _require_live(meeting)

    with atomic(session):
        host = require_host(session, meeting, client_token)
        target = _target(session, meeting, participant_id)
        if target.id == host.id:
            raise InvalidParticipantTransition("You are already the host")
        if target.status != ParticipantStatus.JOINED:
            raise InvalidParticipantTransition(f"Only someone in the meeting can be made host (they are {target.status})")
        _set_state(session, host, (ParticipantStatus.JOINED,), role=ParticipantRole.PARTICIPANT)
        _set_state(session, target, (ParticipantStatus.JOINED,), role=ParticipantRole.HOST)
        return ParticipantView.of(target)
