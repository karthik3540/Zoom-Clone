"""Personal Meeting IDs: the permanent 10-digit identifier of a user.

Not to be confused with a meeting's 11-digit meeting_code (meeting_code.py):
a user has one PMI for life, while every meeting gets a new code.
"""

import secrets
import string

PERSONAL_MEETING_ID_LENGTH = 10


def generate_personal_meeting_id() -> str:
    """Random 10-digit PMI such as "4827319051".

    Drawn from a cryptographically secure source and independent of the
    user's id, email and the time. Like generated meeting codes, the first
    digit is never 0 (so it reads like a Zoom PMI, "482 731 9051"); the
    database accepts any 10 digits. Uniqueness is enforced by the database;
    callers retry on collision.
    """
    first = secrets.choice("123456789")
    rest = "".join(secrets.choice(string.digits) for _ in range(PERSONAL_MEETING_ID_LENGTH - 1))
    return first + rest
