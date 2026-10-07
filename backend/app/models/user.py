from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.columns import (
    created_at_column,
    display_name_column,
    rowid_primary_key,
    timezone_column,
    updated_at_column,
)
from app.services.personal_meeting_id import generate_personal_meeting_id

if TYPE_CHECKING:
    from app.models.meeting import Meeting
    from app.models.participant import MeetingParticipant


class User(Base):
    """An account. Without login, user 1 is the logged-in user in every browser."""

    __tablename__ = "users"

    id: Mapped[int] = rowid_primary_key()
    email: Mapped[str] = mapped_column(Text(collation="NOCASE"), nullable=False, unique=True)
    # The user's permanent 10-digit Personal Meeting ID (not a meeting_code, which has 11).
    # Generated when the user is inserted, so a users row never lacks one.
    personal_meeting_id: Mapped[str] = mapped_column(
        Text,
        CheckConstraint("length(personal_meeting_id) = 10 AND personal_meeting_id NOT GLOB '*[^0-9]*'"),
        nullable=False,
        unique=True,
        default=generate_personal_meeting_id,
    )
    display_name: Mapped[str] = display_name_column()
    avatar_url: Mapped[str | None] = mapped_column(Text)
    # Stays NULL until authentication exists.
    password_hash: Mapped[str | None] = mapped_column(Text)
    timezone: Mapped[str] = timezone_column()
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()

    # Deleting a user deletes their meetings in the database (ON DELETE CASCADE);
    # passive_deletes lets SQLite do it instead of loading every row first.
    hosted_meetings: Mapped[list["Meeting"]] = relationship(
        back_populates="host", cascade="all, delete-orphan", passive_deletes=True
    )
    # Attendance rows survive the user's deletion with user_id set to NULL.
    participations: Mapped[list["MeetingParticipant"]] = relationship(
        back_populates="user", passive_deletes=True
    )
