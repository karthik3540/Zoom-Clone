"""Allowed values of the TEXT status/type/setting columns (enforced by CHECKs in SQLite)."""

from enum import StrEnum


class MeetingType(StrEnum):
    INSTANT = "instant"
    SCHEDULED = "scheduled"


class MeetingStatus(StrEnum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    ENDED = "ended"
    CANCELLED = "cancelled"


class MeetingIdType(StrEnum):
    # Which ID people use to join (the Schedule page's "Meeting ID" choice).
    GENERATED = "generated"  # the meeting's own 11-digit meeting_code
    PERSONAL = "personal"  # the host's 10-digit Personal Meeting ID (scheduled meetings only)


class EncryptionMode(StrEnum):
    ENHANCED = "enhanced"
    END_TO_END = "end_to_end"


class NotesScope(StrEnum):
    # The scheduler's "My Notes" options.
    ORGANIZATION_ONLY = "organization_only"  # "Only participants in your organization"
    ALL_PARTICIPANTS = "all_participants"  # "All participants"


class ParticipantRole(StrEnum):
    HOST = "host"
    PARTICIPANT = "participant"


class ParticipantStatus(StrEnum):
    WAITING = "waiting"  # in the waiting room until the host admits them (revision 5)
    JOINED = "joined"
    LEFT = "left"
    REMOVED = "removed"


class AttachmentKind(StrEnum):
    WHITEBOARD = "whiteboard"
    DOC = "doc"
