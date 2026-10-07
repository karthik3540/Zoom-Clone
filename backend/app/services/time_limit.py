"""When a live meeting ends by itself, and how long a silent browser stays in it.

Like Zoom's free plan, every meeting (instant or scheduled, whatever duration
was chosen) ends MEETING_TIME_LIMIT_MINUTES after it actually started. A browser
that is waiting or in the room checks in every few seconds; one not seen for
PRESENCE_TIMEOUT is checked out as if it had left (its tab was closed without
Leave). See schema_6.sql.
"""

from datetime import datetime, timedelta

from app.models import Meeting

MEETING_TIME_LIMIT_MINUTES = 40
PRESENCE_TIMEOUT = timedelta(seconds=90)


def meeting_ends_at(meeting: Meeting) -> datetime | None:
    """When a started meeting reaches its time limit; None if it has not started."""
    if meeting.started_at is None:
        return None
    return meeting.started_at + timedelta(minutes=MEETING_TIME_LIMIT_MINUTES)
