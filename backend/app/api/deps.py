"""Request context shared by the routes: the database session and the identity headers.

There is no login yet. Two headers identify the caller:
  * X-User-Id      - the account (user 1 is the default user in every browser)
  * X-Client-Token - the browser (a random token kept in localStorage)
They are only parsed here; what they authorize is decided by the services.
"""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.db.session import SessionLocal


def get_db() -> Iterator[Session]:
    """One session per request, always closed afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DbSession = Annotated[Session, Depends(get_db)]

_USER_ID_DOC = "The caller's account. Without login, the default user is 1."
_CLIENT_TOKEN_DOC = "Random per-browser token (at least 16 characters). Secret: never returned by the API."

UserId = Annotated[int, Header(alias="X-User-Id", gt=0, description=_USER_ID_DOC)]
OptionalUserId = Annotated[int | None, Header(alias="X-User-Id", gt=0, description=_USER_ID_DOC)]
ClientToken = Annotated[str, Header(alias="X-Client-Token", description=_CLIENT_TOKEN_DOC)]
OptionalClientToken = Annotated[str | None, Header(alias="X-Client-Token", description=_CLIENT_TOKEN_DOC)]
