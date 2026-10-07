"""Meetings: create, dashboard lists, lookup, Manage details, edit and lifecycle.

Each route parses the request, calls one service, and converts the returned
view into a response model. Validation, authorization, state rules and
transactions all live in app.services.
"""

from fastapi import APIRouter, Response

from app.api.deps import ClientToken, DbSession, OptionalClientToken, OptionalUserId, UserId
from app.schemas.meetings import (
    SETTING_FIELDS,
    ErrorResponse,
    InstantMeetingCreate,
    MeetingDetailsOut,
    MeetingSummaryOut,
    MeetingUpdate,
    ScheduledMeetingCreate,
)
from app.services import meeting_service, participant_service
from app.services.meeting_settings import MeetingSettings

router = APIRouter(prefix="/meetings", tags=["meetings"])

ERRORS = {status: {"model": ErrorResponse} for status in (403, 404, 409, 422)}


@router.post("/instant", response_model=MeetingDetailsOut, status_code=201, responses=ERRORS,
             summary="Start an instant meeting")
def create_instant_meeting(body: InstantMeetingCreate, db: DbSession, user_id: UserId) -> MeetingDetailsOut:
    """Creates a meeting that is live immediately, owned by X-User-Id. The host's browser then joins with `as_host`."""
    details = meeting_service.create_instant_meeting(db, host_id=user_id, title=body.title, settings=body.to_settings())
    return MeetingDetailsOut.model_validate(details)


@router.post("/scheduled", response_model=MeetingDetailsOut, status_code=201, responses=ERRORS,
             summary="Schedule a meeting")
def create_scheduled_meeting(body: ScheduledMeetingCreate, db: DbSession, user_id: UserId) -> MeetingDetailsOut:
    """Creates a scheduled meeting with its settings and attachments in one transaction."""
    details = meeting_service.create_scheduled_meeting(
        db,
        host_id=user_id,
        title=body.title,
        description=body.description,
        scheduled_start=body.scheduled_start_at,
        timezone=body.timezone,
        duration_minutes=body.duration_minutes,
        settings=body.to_settings(),
        attachments=[attachment.to_new() for attachment in body.attachments],
        meeting_id_type=body.meeting_id_type,
    )
    return MeetingDetailsOut.model_validate(details)


@router.get("/upcoming", response_model=list[MeetingSummaryOut], responses=ERRORS, summary="Upcoming meetings")
def list_upcoming_meetings(db: DbSession, user_id: UserId) -> list[MeetingSummaryOut]:
    """Live meetings first, then scheduled meetings whose planned end has not passed. No passcodes."""
    participant_service.refresh_live_meetings(db)
    return [MeetingSummaryOut.model_validate(m) for m in meeting_service.list_upcoming_meetings(db, user_id)]


@router.get("/recent", response_model=list[MeetingSummaryOut], responses=ERRORS, summary="Recent meetings")
def list_recent_meetings(db: DbSession, user_id: UserId) -> list[MeetingSummaryOut]:
    """The 10 most recently ended meetings the user hosted or attended. No passcodes."""
    participant_service.refresh_live_meetings(db)
    return [MeetingSummaryOut.model_validate(m) for m in meeting_service.list_recent_meetings(db, user_id)]


@router.get("/{meeting_code}", response_model=MeetingSummaryOut, responses=ERRORS, summary="Look up a meeting")
def get_public_meeting(meeting_code: str, db: DbSession) -> MeetingSummaryOut:
    """What anyone with the ID may see (invite and join pages). Never includes the passcode.

    Accepts a meeting's 11-digit code or a host's 10-digit Personal Meeting ID
    (their live personal meeting, else the next upcoming one).
    """
    participant_service.refresh_live_meetings(db)
    return MeetingSummaryOut.model_validate(meeting_service.get_public_meeting(db, meeting_code))


@router.get("/{meeting_code}/details", response_model=MeetingDetailsOut, responses=ERRORS,
            summary="Manage Meeting details")
def get_meeting_details(
    meeting_code: str, db: DbSession, user_id: OptionalUserId = None, client_token: OptionalClientToken = None
) -> MeetingDetailsOut:
    """Everything saved for the meeting. `passcode` is filled in only for the owner's account or the active host browser."""
    participant_service.refresh_live_meetings(db)
    details = meeting_service.get_meeting_details(db, meeting_code, user_id=user_id, client_token=client_token)
    return MeetingDetailsOut.model_validate(details)


@router.patch("/{meeting_code}", response_model=MeetingDetailsOut, responses=ERRORS,
              summary="Edit a scheduled meeting")
def update_meeting(meeting_code: str, body: MeetingUpdate, db: DbSession, user_id: UserId) -> MeetingDetailsOut:
    """Owner only, while the meeting is scheduled. Fields that are not sent keep their current values."""
    # PATCH semantics on top of the service's full-form edit: start from the
    # current values (as this caller may see them) and apply what was sent.
    current = meeting_service.get_meeting_details(db, meeting_code, user_id=user_id)
    sent = body.model_dump(exclude_unset=True)
    attachments = sent.pop("attachments", None)

    def value(name: str) -> object:
        return sent[name] if name in sent else getattr(current, name)

    details = meeting_service.update_scheduled_meeting(
        db,
        meeting_code,
        user_id=user_id,
        title=value("title"),
        description=value("description"),
        scheduled_start=value("scheduled_start_at"),
        timezone=value("timezone"),
        duration_minutes=value("duration_minutes"),
        settings=MeetingSettings(**{name: value(name) for name in SETTING_FIELDS}),
        attachments=None if attachments is None else [a.to_new() for a in body.attachments or []],
        meeting_id_type=value("meeting_id_type"),
    )
    return MeetingDetailsOut.model_validate(details)


@router.delete("/{meeting_code}", status_code=204, response_class=Response, responses=ERRORS,
               summary="Delete a meeting")
def delete_meeting(meeting_code: str, db: DbSession, user_id: UserId) -> Response:
    """Removes the meeting, its attachments and its attendance history for good. Owner only.

    Upcoming and ended meetings can be deleted; one in progress cannot (409 meeting_already_started).
    """
    meeting_service.delete_meeting(db, meeting_code, user_id=user_id)
    return Response(status_code=204)


@router.post("/{meeting_code}/start", response_model=MeetingDetailsOut, responses=ERRORS,
             summary="Start a scheduled meeting")
def start_meeting(meeting_code: str, db: DbSession, user_id: UserId) -> MeetingDetailsOut:
    """scheduled -> live, by the owner's account. The browser then joins with `as_host`."""
    return MeetingDetailsOut.model_validate(meeting_service.start_meeting(db, meeting_code, user_id=user_id))


@router.post("/{meeting_code}/end", response_model=MeetingDetailsOut, responses=ERRORS, summary="End a meeting")
def end_meeting(meeting_code: str, db: DbSession, client_token: ClientToken) -> MeetingDetailsOut:
    """live -> ended, by the active host browser; everyone in the room is checked out."""
    return MeetingDetailsOut.model_validate(meeting_service.end_meeting(db, meeting_code, client_token=client_token))

