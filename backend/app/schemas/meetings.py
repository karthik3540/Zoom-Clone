"""Request and response models of the meeting API.

Requests carry only what the services accept (unknown fields are rejected,
so a client token cannot be sent in JSON). Detailed rules - passcode format,
template key, notes scope, durations - are checked by the services, the one
source of truth; these models check types and the fixed value sets.

Responses are built from the service views and contain no secrets: no
client_token, no password_hash, and a passcode only where the service filled
it in for an authorized caller. Times are UTC, serialized as ISO 8601 ending in "Z".
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt

from app.models import AttachmentKind, EncryptionMode, MeetingIdType, NotesScope
from app.services.meeting_settings import MeetingSettings, NewAttachment

SETTING_FIELDS = (
    "passcode", "waiting_room_enabled", "encryption_mode", "notes_enabled", "notes_scope",
    "host_video_enabled", "participant_video_enabled", "template",
)


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- requests ---------------------------------------------------------------------------------


class AttachmentIn(RequestModel):
    kind: AttachmentKind = Field(description="whiteboard or doc")
    title: str

    def to_new(self) -> NewAttachment:
        return NewAttachment(kind=self.kind, title=self.title)


class SettingsIn(RequestModel):
    """The scheduler's settings; omitted fields take the schema's defaults."""

    passcode: str | None = Field(None, description="1-10 characters: letters, digits, @ * _ -. null = no passcode")
    waiting_room_enabled: StrictBool = False
    encryption_mode: EncryptionMode = EncryptionMode.ENHANCED
    notes_enabled: StrictBool = False
    notes_scope: NotesScope | None = Field(None, description="Required exactly when notes_enabled is true")
    host_video_enabled: StrictBool = False
    participant_video_enabled: StrictBool = False
    template: str | None = Field(None, description="Template key from the frontend's catalog (lowercase, a-z 0-9 _ -)")

    def to_settings(self) -> MeetingSettings:
        return MeetingSettings(**{name: getattr(self, name) for name in SETTING_FIELDS})


class InstantMeetingCreate(SettingsIn):
    title: str | None = Field(None, description="Defaults to \"<display name>'s Zoom Meeting\"")


class ScheduledMeetingCreate(SettingsIn):
    title: str
    description: str | None = None
    scheduled_start_at: datetime = Field(
        description="Local wall-clock time in `timezone`, e.g. 2026-10-10 15:30:00. "
        "With an offset (or Z) it is taken as that exact instant."
    )
    duration_minutes: StrictInt = Field(description="1-1440")
    timezone: str = Field(description="IANA timezone name, e.g. Asia/Kolkata")
    meeting_id_type: MeetingIdType = Field(
        MeetingIdType.GENERATED,
        description="generated: join with a new 11-digit Meeting ID; personal: join with your 10-digit Personal Meeting ID",
    )
    attachments: list[AttachmentIn] = Field(default_factory=list)


class MeetingUpdate(RequestModel):
    """Edit a scheduled meeting. Omitted fields keep their current value; null clears optional ones."""

    title: str | None = None
    description: str | None = None
    scheduled_start_at: datetime | None = Field(
        None, description="Local wall-clock time in `timezone` (the new one, if timezone is also sent)"
    )
    duration_minutes: StrictInt | None = None
    timezone: str | None = None
    meeting_id_type: MeetingIdType | None = Field(
        None, description="Switch between the meeting's own ID and your PMI; the IDs themselves never change"
    )
    passcode: str | None = None
    waiting_room_enabled: StrictBool | None = None
    encryption_mode: EncryptionMode | None = None
    notes_enabled: StrictBool | None = None
    notes_scope: NotesScope | None = None
    host_video_enabled: StrictBool | None = None
    participant_video_enabled: StrictBool | None = None
    template: str | None = None
    attachments: list[AttachmentIn] | None = Field(
        None, description="When sent, replaces the attachments (unchanged ones keep their id)"
    )


class JoinRequest(RequestModel):
    display_name: str
    passcode: str | None = Field(None, description="Required when the meeting has a passcode, the host included")
    as_host: StrictBool = Field(
        False, description="Set by the owner's browser after creating or starting the meeting to take the host role"
    )


class ParticipantRename(RequestModel):
    """The only participant field a client may change directly; role and status have dedicated actions."""

    display_name: str = Field(description="The name shown in this meeting (the account's name is not changed)")


# --- responses --------------------------------------------------------------------------------


class AttachmentOut(ResponseModel):
    id: int
    kind: str
    title: str
    created_at: datetime


class MeetingSummaryOut(ResponseModel):
    """Safe for anyone holding the meeting code: never contains the passcode."""

    meeting_code: str = Field(description="The meeting's own 11-digit ID; the key of the owner and host API paths")
    meeting_id_type: str = Field(description="generated or personal")
    public_meeting_id: str = Field(
        description="The ID people join with: meeting_code, or the host's 10-digit Personal Meeting ID"
    )
    invite_url: str
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
    ends_at: datetime | None = Field(
        description="When a started meeting ends by itself: 40 minutes after it started (free plan limit)"
    )
    has_passcode: bool
    passcode_required: bool  # joining asks for the passcode (scheduled meetings only)
    waiting_room_enabled: bool


class MeetingDetailsOut(MeetingSummaryOut):
    """Everything the Manage Meeting page shows; passcode is null unless the caller is the owner or host."""

    passcode: str | None
    encryption_mode: str
    notes_enabled: bool
    notes_scope: str | None
    host_video_enabled: bool
    participant_video_enabled: bool
    template: str | None
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentOut]


class ParticipantOut(ResponseModel):
    """One join of one browser. Never includes the browser's client_token.

    status: waiting (in the waiting room, not admitted yet), joined, left or removed.
    """

    id: int
    display_name: str
    role: str
    status: str
    is_muted: bool
    is_video_on: bool
    joined_at: datetime
    left_at: datetime | None


class JoinResponse(ResponseModel):
    participant: ParticipantOut
    reused: bool = Field(description="True when this browser was already in the room (page refresh)")


class LeaveResponse(ResponseModel):
    left: bool = Field(description="False when the browser had already left or been removed")
    meeting_ended: bool = Field(description="True when the last participant left a live meeting")


class MuteAllResponse(BaseModel):
    muted: int = Field(description="Participants updated (everyone in the room except the host)")


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
