"""Participants: join, the waiting room, leave, roster and host controls. The browser is always X-Client-Token.

Host controls are checked by the service against the caller's browser being
the meeting's active host; a participant id in the path never proves anything.
"""

from fastapi import APIRouter

from app.api.deps import ClientToken, DbSession, OptionalUserId
from app.schemas.meetings import (
    ErrorResponse,
    JoinRequest,
    JoinResponse,
    LeaveResponse,
    MuteAllResponse,
    ParticipantOut,
    ParticipantRename,
)
from app.services import participant_service

router = APIRouter(prefix="/meetings/{meeting_code}", tags=["participants"])

ERRORS = {status: {"model": ErrorResponse} for status in (403, 404, 409, 422)}


@router.post("/join", response_model=JoinResponse, responses=ERRORS, summary="Join a meeting")
def join_meeting(
    meeting_code: str, body: JoinRequest, db: DbSession, client_token: ClientToken, user_id: OptionalUserId = None
) -> JoinResponse:
    """Joins this browser (X-Client-Token); without X-User-Id it joins as a guest.

    With the meeting's waiting room on, everyone but the host gets `status: waiting` until admitted.
    A refresh reuses the browser's row (`reused: true`). A browser the host removed cannot rejoin.
    """
    result = participant_service.join_meeting(
        db,
        meeting_code,
        client_token=client_token,
        display_name=body.display_name,
        user_id=user_id,
        as_host=body.as_host,
        passcode=body.passcode,
    )
    return JoinResponse.model_validate(result)


@router.post("/leave", response_model=LeaveResponse, responses=ERRORS, summary="Leave a meeting")
def leave_meeting(meeting_code: str, db: DbSession, client_token: ClientToken) -> LeaveResponse:
    """Safe to repeat. When the last participant leaves a live meeting, it ends."""
    return LeaveResponse.model_validate(participant_service.leave_meeting(db, meeting_code, client_token=client_token))


@router.get("/participants", response_model=list[ParticipantOut], responses=ERRORS, summary="Who is in the meeting")
def list_participants(meeting_code: str, db: DbSession, client_token: ClientToken) -> list[ParticipantOut]:
    """Participants in the room; the host also gets those in the waiting room. Only a browser in the room may ask."""
    rows = participant_service.list_participants(db, meeting_code, client_token=client_token)
    return [ParticipantOut.model_validate(row) for row in rows]


@router.post("/mute-all", response_model=MuteAllResponse, responses=ERRORS, summary="Mute everyone (host)")
def mute_all(meeting_code: str, db: DbSession, client_token: ClientToken) -> MuteAllResponse:
    """Mutes everyone in the room except the host. Active host browser only."""
    return MuteAllResponse(muted=participant_service.mute_all(db, meeting_code, client_token=client_token))


@router.post("/participants/{participant_id}/remove", response_model=ParticipantOut, responses=ERRORS,
             summary="Remove a participant (host)")
def remove_participant(meeting_code: str, participant_id: int, db: DbSession, client_token: ClientToken) -> ParticipantOut:
    """waiting or joined -> removed; that browser cannot rejoin this meeting. Active host browser only."""
    removed = participant_service.remove_participant(
        db, meeting_code, client_token=client_token, participant_id=participant_id
    )
    return ParticipantOut.model_validate(removed)


@router.get("/participants/me", response_model=ParticipantOut, responses=ERRORS, summary="This browser's state")
def get_own_participant(meeting_code: str, db: DbSession, client_token: ClientToken) -> ParticipantOut:
    """This browser's row: `waiting` until the host admits it, then `joined`. 403 once removed."""
    return ParticipantOut.model_validate(
        participant_service.get_own_participant(db, meeting_code, client_token=client_token)
    )


@router.post("/participants/{participant_id}/admit", response_model=ParticipantOut, responses=ERRORS,
             summary="Admit from the waiting room (host)")
def admit_participant(meeting_code: str, participant_id: int, db: DbSession, client_token: ClientToken) -> ParticipantOut:
    """waiting -> joined. Active host browser only."""
    return ParticipantOut.model_validate(
        participant_service.admit_participant(db, meeting_code, client_token=client_token, participant_id=participant_id)
    )


@router.post("/participants/{participant_id}/waiting-room", response_model=ParticipantOut, responses=ERRORS,
             summary="Put in the waiting room (host)")
def move_to_waiting_room(meeting_code: str, participant_id: int, db: DbSession, client_token: ClientToken) -> ParticipantOut:
    """joined -> waiting. Active host browser only; not the host."""
    return ParticipantOut.model_validate(
        participant_service.move_to_waiting_room(
            db, meeting_code, client_token=client_token, participant_id=participant_id
        )
    )


@router.patch("/participants/{participant_id}", response_model=ParticipantOut, responses=ERRORS,
              summary="Rename a participant")
def rename_participant(
    meeting_code: str, participant_id: int, body: ParticipantRename, db: DbSession, client_token: ClientToken
) -> ParticipantOut:
    """Changes the name shown in this meeting. Yourself, or anyone if you are the active host."""
    return ParticipantOut.model_validate(
        participant_service.rename_participant(
            db, meeting_code, client_token=client_token, participant_id=participant_id, display_name=body.display_name
        )
    )


@router.post("/participants/{participant_id}/make-host", response_model=ParticipantOut, responses=ERRORS,
             summary="Make someone the host (host)")
def make_host(meeting_code: str, participant_id: int, db: DbSession, client_token: ClientToken) -> ParticipantOut:
    """Hands the host role to someone in the room; you become a participant. Active host browser only."""
    return ParticipantOut.model_validate(
        participant_service.make_host(db, meeting_code, client_token=client_token, participant_id=participant_id)
    )
