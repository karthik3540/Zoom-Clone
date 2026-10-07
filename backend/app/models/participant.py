from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.columns import display_name_column, flag_column, rowid_primary_key
from app.db.types import UTCTimestamp, utc_now

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.user import User


class MeetingParticipant(Base):
    """One row per JOIN, so leaving and rejoining keeps the attendance history."""

    __tablename__ = "meeting_participants"
    __table_args__ = (
        # waiting or in the room = no left_at; left or removed = has a left_at
        CheckConstraint(
            "(status IN ('waiting', 'joined') AND left_at IS NULL)"
            " OR (status IN ('left', 'removed')"
            " AND left_at IS NOT NULL AND left_at >= joined_at)",
            name="ck_participants_lifecycle",
        ),
        # Roster of a meeting (and the lookups by meeting in the join flow)
        Index("idx_participants_meeting_status", "meeting_id", "status"),
        # "Meetings I attended" for the Recent section
        Index("idx_participants_user_meeting", "user_id", "meeting_id"),
        # One browser can be in a given meeting (waiting or joined) only once at a time
        Index(
            "uq_participants_one_active_per_client",
            "meeting_id",
            "client_token",
            unique=True,
            sqlite_where=text("status IN ('waiting', 'joined')"),
        ),
        # A meeting has at most one host in the room at a time
        Index(
            "uq_participants_one_active_host",
            "meeting_id",
            unique=True,
            sqlite_where=text("status = 'joined' AND role = 'host'"),
        ),
    )

    id: Mapped[int] = rowid_primary_key()
    meeting_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
    )
    # NULL for a visitor without an account; client_token tells browsers apart.
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    # Random per-browser UUID kept in localStorage. A secret: never expose it in API responses.
    client_token: Mapped[str] = mapped_column(
        Text, CheckConstraint("length(client_token) >= 16"), nullable=False
    )
    # Name typed when joining; a snapshot, not read from users.
    display_name: Mapped[str] = display_name_column()
    role: Mapped[str] = mapped_column(
        Text,
        CheckConstraint("role IN ('host', 'participant')"),
        nullable=False,
        default="participant",
        server_default="participant",
    )
    status: Mapped[str] = mapped_column(
        Text,
        # 'waiting': in the waiting room, not yet admitted by the host (revision 5)
        CheckConstraint("status IN ('waiting', 'joined', 'left', 'removed')"),
        nullable=False,
        default="joined",
        server_default="joined",
    )
    is_muted: Mapped[bool] = flag_column("is_muted", default=True)
    is_video_on: Mapped[bool] = flag_column("is_video_on", default=False)
    joined_at: Mapped[datetime] = mapped_column(
        UTCTimestamp, nullable=False, default=utc_now, server_default=text("CURRENT_TIMESTAMP")
    )
    left_at: Mapped[datetime | None] = mapped_column(UTCTimestamp)
    # When this browser last checked in (revision 6); a silent row is checked out as 'left'.
    last_seen_at: Mapped[datetime] = mapped_column(
        UTCTimestamp, nullable=False, default=utc_now, server_default=text("CURRENT_TIMESTAMP")
    )

    meeting: Mapped["Meeting"] = relationship(back_populates="participants")
    user: Mapped["User | None"] = relationship(back_populates="participations")
