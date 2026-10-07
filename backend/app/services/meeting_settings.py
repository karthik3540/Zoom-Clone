"""Inputs of the Schedule / Edit Meeting form, and their validation.

Pure validation, no database access. The rules mirror the CHECK constraints
of schema_6.sql so callers get an InvalidMeetingInput naming the field
instead of a database error; SQLite still enforces the same rules.
Error messages never contain a passcode.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from app.models import AttachmentKind, EncryptionMode, NotesScope
from app.services.exceptions import InvalidMeetingInput

PASSCODE_PATTERN = re.compile(r"[A-Za-z0-9@*_-]{1,10}")
TEMPLATE_PATTERN = re.compile(r"[a-z0-9_-]{1,64}")


@dataclass(frozen=True)
class MeetingSettings:
    """The scheduler's settings. The defaults are the schema's defaults."""

    passcode: str | None = field(default=None, repr=False)  # None = no passcode
    waiting_room_enabled: bool = False
    encryption_mode: str = EncryptionMode.ENHANCED
    notes_enabled: bool = False
    notes_scope: str | None = None  # required exactly when notes are enabled
    host_video_enabled: bool = False
    participant_video_enabled: bool = False
    template: str | None = None  # template key from the frontend's catalog


@dataclass(frozen=True)
class NewAttachment:
    kind: str  # "whiteboard" or "doc"
    title: str


def clean_text(value: Any, field_name: str, *, required: bool = True) -> str | None:
    """Strip a text input; blank counts as missing."""
    if value is not None and not isinstance(value, str):
        raise InvalidMeetingInput(field_name, "must be text")
    cleaned = value.strip() if value else ""
    if cleaned:
        return cleaned
    if required:
        raise InvalidMeetingInput(field_name, "must not be blank")
    return None


def _flag(value: Any, field_name: str) -> bool:
    if not isinstance(value, bool):
        raise InvalidMeetingInput(field_name, "must be true or false")
    return value


def _choice(value: Any, field_name: str, allowed: type[EncryptionMode] | type[NotesScope] | type[AttachmentKind]) -> str:
    values = [member.value for member in allowed]
    if value not in values:
        raise InvalidMeetingInput(field_name, f"must be one of {', '.join(values)}")
    return str(value)


def validate_passcode(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not PASSCODE_PATTERN.fullmatch(value):
        raise InvalidMeetingInput("passcode", "must be 1-10 characters: letters, digits, @ * _ -")
    return value


def validate_settings(settings: Any) -> dict[str, Any]:
    """Validate a MeetingSettings and return the meetings column values to store."""
    if settings is None:
        settings = MeetingSettings()
    if not isinstance(settings, MeetingSettings):
        raise InvalidMeetingInput("settings", "must be a MeetingSettings")

    notes_enabled = _flag(settings.notes_enabled, "notes_enabled")
    if notes_enabled:
        if settings.notes_scope is None:
            raise InvalidMeetingInput("notes_scope", "is required when notes are enabled")
        notes_scope: str | None = _choice(settings.notes_scope, "notes_scope", NotesScope)
    elif settings.notes_scope is not None:
        raise InvalidMeetingInput("notes_scope", "must be omitted when notes are disabled")
    else:
        notes_scope = None

    template = settings.template
    if template is not None and (not isinstance(template, str) or not TEMPLATE_PATTERN.fullmatch(template)):
        raise InvalidMeetingInput("template", "must be a lowercase key of 1-64 characters: a-z, 0-9, _ and -")

    return {
        "passcode": validate_passcode(settings.passcode),
        "waiting_room_enabled": _flag(settings.waiting_room_enabled, "waiting_room_enabled"),
        "encryption_mode": _choice(settings.encryption_mode, "encryption_mode", EncryptionMode),
        "notes_enabled": notes_enabled,
        "notes_scope": notes_scope,
        "host_video_enabled": _flag(settings.host_video_enabled, "host_video_enabled"),
        "participant_video_enabled": _flag(settings.participant_video_enabled, "participant_video_enabled"),
        "template": template,
    }


def validate_attachment(kind: Any, title: Any) -> tuple[str, str]:
    """Validate one attachment and return (kind, cleaned title)."""
    return _choice(kind, "kind", AttachmentKind), clean_text(title, "title")  # type: ignore[return-value]


def validate_attachments(attachments: Any) -> list[tuple[str, str]]:
    if attachments is None:
        return []
    if isinstance(attachments, (str, bytes)) or not isinstance(attachments, Sequence):
        raise InvalidMeetingInput("attachments", "must be a list of attachments")
    validated = []
    for item in attachments:
        if not isinstance(item, NewAttachment):
            raise InvalidMeetingInput("attachments", "each attachment must be a NewAttachment")
        validated.append(validate_attachment(item.kind, item.title))
    return validated
