"""One place that turns errors into HTTP responses.

Every error response has the same shape:
    {"error": {"code": "<machine-readable>", "message": "<human-readable>", ...}}
Responses never echo request input, SQL, stack traces or file paths, so a
passcode or client token sent by the caller cannot come back in an error.
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.services.exceptions import (
    AttachmentNotFound,
    InvalidMeetingInput,
    InvalidMeetingTransition,
    InvalidParticipantTransition,
    InvalidPasscode,
    MeetingAlreadyEnded,
    MeetingAlreadyStarted,
    MeetingCodeUnavailable,
    MeetingNotFound,
    MeetingNotJoinable,
    MeetingNotLive,
    NotMeetingHost,
    NotMeetingParticipant,
    ParticipantNotFound,
    ParticipantRemoved,
    ServiceError,
    UserNotFound,
)

# Service error -> (HTTP status, error code). Looked up along the exception's
# class hierarchy, so a subclass may refine its parent's mapping.
SERVICE_ERRORS: dict[type[ServiceError], tuple[int, str]] = {
    MeetingNotFound: (404, "meeting_not_found"),
    ParticipantNotFound: (404, "participant_not_found"),
    AttachmentNotFound: (404, "attachment_not_found"),
    UserNotFound: (404, "user_not_found"),
    InvalidMeetingInput: (422, "invalid_input"),
    InvalidPasscode: (403, "invalid_passcode"),
    NotMeetingHost: (403, "not_meeting_host"),
    NotMeetingParticipant: (403, "not_meeting_participant"),
    ParticipantRemoved: (403, "participant_removed"),
    MeetingNotJoinable: (409, "meeting_not_joinable"),
    MeetingNotLive: (409, "meeting_not_live"),
    InvalidParticipantTransition: (409, "invalid_participant_transition"),
    MeetingAlreadyStarted: (409, "meeting_already_started"),
    MeetingAlreadyEnded: (409, "meeting_already_ended"),
    InvalidMeetingTransition: (409, "invalid_meeting_transition"),
    MeetingCodeUnavailable: (503, "meeting_code_unavailable"),
    ServiceError: (400, "invalid_request"),
}

HTTP_CODES = {404: "not_found", 405: "method_not_allowed"}


def error_response(status: int, code: str, message: str, **details: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, **details}})


async def handle_service_error(_request: Request, error: Exception) -> JSONResponse:
    status, code = next(SERVICE_ERRORS[cls] for cls in type(error).__mro__ if cls in SERVICE_ERRORS)
    details: dict[str, Any] = {}
    if isinstance(error, InvalidMeetingInput):
        details["field"] = error.field
    if isinstance(error, InvalidPasscode):
        details["reason"] = error.reason  # "missing" or "incorrect"
    # Service messages are written to be safe to show: they never contain a passcode or token.
    return error_response(status, code, str(error), **details)


async def handle_validation_error(_request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, RequestValidationError)
    # Only where and what, never the rejected input (it may be a passcode or token).
    fields = [
        {"location": [str(part) for part in item.get("loc", ())], "message": item.get("msg", "Invalid value")}
        for item in error.errors()
    ]
    return error_response(422, "validation_error", "The request is not valid", fields=fields)


async def handle_http_error(_request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, StarletteHTTPException)
    return error_response(error.status_code, HTTP_CODES.get(error.status_code, "http_error"), str(error.detail))


async def handle_unexpected_error(_request: Request, _error: Exception) -> JSONResponse:
    # The traceback is still logged by the server; the client gets nothing internal.
    return error_response(500, "internal_error", "Something went wrong on the server")


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ServiceError, handle_service_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_error)
    app.add_exception_handler(Exception, handle_unexpected_error)
