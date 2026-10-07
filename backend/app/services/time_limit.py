"""When a live meeting ends by itself, and how long a silent browser stays in it.

A scheduled meeting ends `duration_minutes` after it actually started; an
instant meeting ends INSTANT_TIME_LIMIT_MINUTES after it started (Zoom's
free-plan limit). A browser that is waiting or in the room checks in every
few seconds; one not seen for PRESENCE_TIMEOUT is checked out as if it had
left (its tab was closed without Leave). See schema_6.sql.
"""

from datetime import datetime, timedelta

from app.models import Meeting, MeetingType

INSTANT_TIME_LIMIT_MINUTES = 40
PRESENCE_TIMEOUT = timedelta(seconds=90)


def meeting_ends_at(meeting: Meeting) -> datetime | None:
    """When a started meeting reaches its time limit; None if it has not started."""
    if meeting.started_at is None:
        return None
    minutes = (
        meeting.duration_minutes
        if meeting.meeting_type == MeetingType.SCHEDULED and meeting.duration_minutes
        else INSTANT_TIME_LIMIT_MINUTES
    )
    return meeting.started_at + timedelta(minutes=minutes)
