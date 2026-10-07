"""Identify the person using the app by email (no authentication).

The same email always maps to the same users row: the lookup relies on the
column's COLLATE NOCASE (so letter case does not matter) and its UNIQUE
constraint (so concurrent first visits cannot create two rows). No other
canonicalization is applied (dots and +tags are kept as typed).

A new user also gets a random Personal Meeting ID before it is committed; an
existing user's PMI is returned as stored and never regenerated.
"""

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.services.exceptions import InvalidMeetingInput, UserNotFound
from app.services.personal_meeting_id import generate_personal_meeting_id

_NAME_PARTS = re.compile(r"[._+\-]+")
# Attempts to insert a new user when its random PMI collides with another user's
# (about one chance in 9 * 10**9 per existing user, so more than one is rare).
MAX_PMI_ATTEMPTS = 5


@dataclass(frozen=True)
class UserView:
    id: int
    email: str
    display_name: str
    personal_meeting_id: str


@dataclass(frozen=True)
class IdentifyResult:
    user: UserView
    is_new: bool  # True when this call created the user


def display_name_from_email(email: str) -> str:
    """Deterministic name for a new user: "john.doe@x" -> "John Doe", "student123@x" -> "Student123"."""
    local_part = email.split("@", 1)[0]
    words = [word[0].upper() + word[1:] for word in _NAME_PARTS.split(local_part) if word]
    return " ".join(words) or local_part or "User"


def _find_user(session: Session, email: str) -> User | None:
    # users.email is COLLATE NOCASE, so this comparison ignores letter case.
    return session.scalar(select(User).where(User.email == email))


def _view(user: User) -> UserView:
    return UserView(
        id=user.id, email=user.email, display_name=user.display_name, personal_meeting_id=user.personal_meeting_id
    )


def get_user(session: Session, user_id: int) -> UserView:
    """The identified user (X-User-Id), with their permanent Personal Meeting ID."""
    user = session.get(User, user_id) if isinstance(user_id, int) else None
    if user is None:
        raise UserNotFound(user_id)
    return _view(user)


def identify_or_create_user(session: Session, email: str) -> IdentifyResult:
    """Return the user with this email, creating it on first use.

    An existing user's record (including display_name) is returned unchanged.
    """
    email = email.strip() if isinstance(email, str) else ""
    if not email:
        raise InvalidMeetingInput("email", "must not be blank")

    existing = _find_user(session, email)
    if existing is not None:
        return IdentifyResult(_view(existing), is_new=False)

    for attempt in range(1, MAX_PMI_ATTEMPTS + 1):
        user = User(
            email=email, display_name=display_name_from_email(email), personal_meeting_id=generate_personal_meeting_id()
        )
        session.add(user)
        try:
            session.commit()
        except IntegrityError as error:
            session.rollback()
            message = str(error.orig)
            if "UNIQUE constraint failed: users.personal_meeting_id" in message and attempt < MAX_PMI_ATTEMPTS:
                continue  # another user already has this PMI: try a new one
            if "UNIQUE constraint failed: users.email" not in message:
                raise
            # Another request created this user between our lookup and our insert.
            winner = _find_user(session, email)
            if winner is None:
                raise
            return IdentifyResult(_view(winner), is_new=False)
        except BaseException:
            session.rollback()
            raise
        return IdentifyResult(_view(user), is_new=True)
    raise AssertionError("unreachable")  # the last attempt returns or raises
