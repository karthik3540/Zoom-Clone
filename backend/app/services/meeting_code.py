"""Meeting codes (the public meeting identifier) and the invite links built from them."""

import re
import secrets
import string

from app.config import settings

MEETING_CODE_LENGTH = 11
_SEPARATORS = re.compile(r"[\s-]+")


def generate_meeting_code() -> str:
    """Random 11-digit code such as "47120983356".

    Uses a cryptographically secure source because, without passcodes,
    knowing the code is enough to join. The first digit is never 0 so the
    code reads like a Zoom meeting ID ("471 2098 3356"). Uniqueness is
    enforced by the database; callers retry on collision.
    """
    first = secrets.choice("123456789")
    rest = "".join(secrets.choice(string.digits) for _ in range(MEETING_CODE_LENGTH - 1))
    return first + rest


def normalize_meeting_code(raw: str) -> str:
    """Accept codes as people type them: "851 2345 6789" and "851-2345-6789" become "85123456789"."""
    return _SEPARATORS.sub("", raw.strip())


def invite_url(meeting_code: str, frontend_url: str | None = None) -> str:
    """Derived, never stored, so links follow the deployment's FRONTEND_URL."""
    base = (frontend_url if frontend_url is not None else settings.frontend_url).rstrip("/")
    return f"{base}/j/{meeting_code}"
