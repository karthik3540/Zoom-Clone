from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.columns import (
    created_at_column,
    flag_column,
    rowid_primary_key,
    timezone_column,
    updated_at_column,
)
from app.db.types import UTCTimestamp
from app.models.enums import EncryptionMode, MeetingIdType

if TYPE_CHECKING:
    from app.models.attachment import MeetingAttachment
    from app.models.participant import MeetingParticipant
    from app.models.user import User


class Meeting(Base):
    """An instant or scheduled meeting. Runs once: scheduled -> live -> ended.

    scheduled_start_at / duration_minutes are the plan; started_at / ended_at
    are what actually happened. meeting_code is the meeting's own 11-digit ID;
    meeting_id_type says whether people join with it or with the host's PMI.
    The settings columns hold what the scheduler saved; their defaults change
    no behavior (no passcode, no waiting room, notes and video off).
    """

    __tablename__ = "meetings"
    __table_args__ = (
        # scheduled meetings carry a plan; instant meetings never do
        CheckConstraint(
            "(meeting_type = 'scheduled' AND scheduled_start_at IS NOT NULL"
            " AND duration_minutes IS NOT NULL)"
            " OR (meeting_type = 'instant' AND scheduled_start_at IS NULL"
            " AND duration_minutes IS NULL)",
            name="ck_meetings_type_schedule",
        ),
        # an instant meeting starts the moment it is created
        CheckConstraint(
            "meeting_type = 'scheduled' OR status IN ('live', 'ended')",
            name="ck_meetings_instant_starts_live",
        ),
        # one row per allowed state: status and timestamps cannot disagree
        CheckConstraint(
            "(status IN ('scheduled', 'cancelled')"
            " AND started_at IS NULL AND ended_at IS NULL)"
            " OR (status = 'live'"
            " AND started_at IS NOT NULL AND ended_at IS NULL)"
            " OR (status = 'ended'"
            " AND started_at IS NOT NULL AND ended_at IS NOT NULL"
            " AND ended_at >= started_at)",
            name="ck_meetings_lifecycle",
        ),
        # notes have a scope exactly when they are enabled
        CheckConstraint(
            "(notes_enabled = 0 AND notes_scope IS NULL)"
            " OR (notes_enabled = 1 AND notes_scope IS NOT NULL)",
            name="ck_meetings_notes_scope",
        ),
        # Upcoming section: host_id = ? AND status IN ('scheduled', 'live')
        Index("idx_meetings_host_status_start", "host_id", "status", "scheduled_start_at"),
    )

    id: Mapped[int] = rowid_primary_key()
    # Zoom-style 11-digit id, stored as TEXT because it is an identifier.
    meeting_code: Mapped[str] = mapped_column(
        Text,
        CheckConstraint("length(meeting_code) = 11 AND meeting_code NOT GLOB '*[^0-9]*'"),
        nullable=False,
        unique=True,
    )
    host_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, CheckConstraint("length(trim(title)) > 0"), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    meeting_type: Mapped[str] = mapped_column(
        Text, CheckConstraint("meeting_type IN ('instant', 'scheduled')"), nullable=False
    )
    # No default on purpose: every insert must say whether it starts live or scheduled.
    status: Mapped[str] = mapped_column(
        Text,
        CheckConstraint("status IN ('scheduled', 'live', 'ended', 'cancelled')"),
        nullable=False,
    )
    scheduled_start_at: Mapped[datetime | None] = mapped_column(UTCTimestamp)
    duration_minutes: Mapped[int | None] = mapped_column(
        Integer, CheckConstraint("duration_minutes BETWEEN 1 AND 1440")
    )
    timezone: Mapped[str] = timezone_column()

    # --- settings saved by the scheduler -------------------------------------------
    # NULL = no passcode. Zoom's rule: 1-10 characters, letters, digits and @ * _ -.
    # Stored as typed: the host sees it on the details page. Only the host may read it.
    passcode: Mapped[str | None] = mapped_column(
        Text,
        CheckConstraint(
            "passcode IS NULL OR (length(passcode) BETWEEN 1 AND 10"
            " AND passcode NOT GLOB '*[^A-Za-z0-9@*_-]*')"
        ),
    )
    waiting_room_enabled: Mapped[bool] = flag_column("waiting_room_enabled", default=False)
    encryption_mode: Mapped[str] = mapped_column(
        Text,
        CheckConstraint("encryption_mode IN ('enhanced', 'end_to_end')"),
        nullable=False,
        default=EncryptionMode.ENHANCED,
        server_default=EncryptionMode.ENHANCED.value,
    )
    notes_enabled: Mapped[bool] = flag_column("notes_enabled", default=False)
    # Who can access the notes; required exactly when notes are enabled.
    notes_scope: Mapped[str | None] = mapped_column(
        Text, CheckConstraint("notes_scope IN ('organization_only', 'all_participants')")
    )
    host_video_enabled: Mapped[bool] = flag_column("host_video_enabled", default=False)
    participant_video_enabled: Mapped[bool] = flag_column("participant_video_enabled", default=False)
    # Key of the template chosen in the scheduler (the catalog lives in the frontend).
    template: Mapped[str | None] = mapped_column(
        Text,
        CheckConstraint(
            "template IS NULL OR (length(template) BETWEEN 1 AND 64"
            " AND template NOT GLOB '*[^a-z0-9_-]*')"
        ),
    )

    started_at: Mapped[datetime | None] = mapped_column(UTCTimestamp)
    ended_at: Mapped[datetime | None] = mapped_column(UTCTimestamp)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
    # Revision 4 (last because it was added with ALTER TABLE): join with this meeting's
    # meeting_code ('generated') or with the host's Personal Meeting ID ('personal',
    # read from users and never copied here). Only scheduled meetings may use the PMI.
    meeting_id_type: Mapped[str] = mapped_column(
        Text,
        CheckConstraint(
            "meeting_id_type = 'generated'"
            " OR (meeting_id_type = 'personal' AND meeting_type = 'scheduled')"
        ),
        nullable=False,
        default=MeetingIdType.GENERATED,
        server_default=MeetingIdType.GENERATED.value,
    )

    host: Mapped["User"] = relationship(back_populates="hosted_meetings")
    # Participants are deleted with their meeting (ON DELETE CASCADE in SQLite).
    participants: Mapped[list["MeetingParticipant"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan", passive_deletes=True
    )
    # Whiteboards and docs, in the order they were added. Deleted with the meeting
    # (ON DELETE CASCADE); removing one from this list deletes its row.
    attachments: Mapped[list["MeetingAttachment"]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="MeetingAttachment.id",
    )


# Recent section: host_id = ? AND status = 'ended' ORDER BY ended_at DESC
Index(
    "idx_meetings_host_ended",
    Meeting.host_id,
    Meeting.ended_at.desc(),
    sqlite_where=text("status = 'ended'"),
)

# A PMI names one meeting at a time: at most one live personal meeting per host.
Index(
    "uq_meetings_one_live_personal_per_host",
    Meeting.host_id,
    unique=True,
    sqlite_where=text("meeting_id_type = 'personal' AND status = 'live'"),
)
