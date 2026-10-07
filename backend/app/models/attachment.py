from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.columns import created_at_column, rowid_primary_key

if TYPE_CHECKING:
    from app.models.meeting import Meeting


class MeetingAttachment(Base):
    """A whiteboard or doc attached to a meeting in the scheduler.

    Records the attachment itself (kind and name), not whiteboard or document
    content. Attachments are configuration, not history: removing one deletes
    its row, and deleting the meeting deletes them all.
    """

    __tablename__ = "meeting_attachments"
    __table_args__ = (
        # Attachments of a meeting, in the order they were added
        Index("idx_attachments_meeting", "meeting_id", "id"),
    )

    id: Mapped[int] = rowid_primary_key()
    meeting_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, CheckConstraint("kind IN ('whiteboard', 'doc')"), nullable=False)
    title: Mapped[str] = mapped_column(Text, CheckConstraint("length(trim(title)) > 0"), nullable=False)
    created_at: Mapped[datetime] = created_at_column()

    meeting: Mapped["Meeting"] = relationship(back_populates="attachments")
