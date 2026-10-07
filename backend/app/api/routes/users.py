"""Who is using the app: email-based identification (there is no authentication)."""

from fastapi import APIRouter

from app.api.deps import DbSession, UserId
from app.schemas.meetings import ErrorResponse
from app.schemas.users import IdentifyRequest, IdentifyResponse, UserOut
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/identify", response_model=IdentifyResponse, responses={422: {"model": ErrorResponse}},
             summary="Identify a user by email")
def identify_user(body: IdentifyRequest, db: DbSession) -> IdentifyResponse:
    """Returns the user with this email, creating it on first use (letter case is ignored).

    Store the returned `id` and send it as `X-User-Id` on later requests. No headers are needed here.
    """
    result = user_service.identify_or_create_user(db, body.email)
    return IdentifyResponse(**result.user.__dict__, is_new=result.is_new)


@router.get("/me", response_model=UserOut, responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
            summary="The identified user")
def get_current_user(db: DbSession, user_id: UserId) -> UserOut:
    """The user named by `X-User-Id`, including their permanent Personal Meeting ID."""
    return UserOut(**user_service.get_user(db, user_id).__dict__)
