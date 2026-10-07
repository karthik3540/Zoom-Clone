"""Domain errors raised by the service layer.

They carry no HTTP semantics; the API layer maps them to responses.
Messages never include a client_token, which is a secret.
"""


class ServiceError(Exception):
    """Base class for every service-layer error."""


class InvalidMeetingInput(ServiceError):
    """A caller-supplied value is missing or invalid."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(f"{field}: {message}")
        self.field = field


class UserNotFound(ServiceError):
    def __init__(self, user_id: int) -> None:
        super().__init__(f"User {user_id} does not exist")
        self.user_id = user_id


class MeetingNotFound(ServiceError):
    def __init__(self, meeting_code: str) -> None:
        super().__init__(f"No meeting with code {meeting_code!r}")
        self.meeting_code = meeting_code


class MeetingCodeUnavailable(ServiceError):
    """No unused meeting code was found after several attempts."""


class MeetingNotJoinable(ServiceError):
    """The meeting has ended or was cancelled."""

    def __init__(self, meeting_code: str, status: str) -> None:
        super().__init__(f"Meeting {meeting_code} cannot be joined because it is {status}")
        self.meeting_code = meeting_code
        self.status = status


class MeetingNotLive(ServiceError):
    """The operation needs a live meeting."""

    def __init__(self, meeting_code: str, status: str) -> None:
        super().__init__(f"Meeting {meeting_code} is {status}, not live")
        self.meeting_code = meeting_code
        self.status = status


class InvalidMeetingTransition(ServiceError):
    """The meeting's current state does not allow the requested lifecycle change."""

    def __init__(self, meeting_code: str, status: str, action: str, reason: str | None = None) -> None:
        super().__init__(reason or f"Cannot {action} meeting {meeting_code} because it is {status}")
        self.meeting_code = meeting_code
        self.status = status
        self.action = action


class MeetingAlreadyStarted(InvalidMeetingTransition):
    pass


class MeetingAlreadyEnded(InvalidMeetingTransition):
    pass


class InvalidPasscode(ServiceError):
    """The meeting has a passcode and the caller did not supply the right one.

    `reason` is "missing" or "incorrect". The message never contains a passcode.
    """

    def __init__(self, reason: str) -> None:
        message = "This meeting requires a passcode" if reason == "missing" else "The passcode is incorrect"
        super().__init__(message)
        self.reason = reason


class AttachmentNotFound(ServiceError):
    """No attachment with that id belongs to the meeting."""


class ParticipantNotFound(ServiceError):
    """No (active) participant matches the request."""


class ParticipantRemoved(ServiceError):
    """The host removed this browser from the meeting; it may not rejoin."""


class NotMeetingParticipant(ServiceError):
    """The caller's browser is not in the meeting."""


class NotMeetingHost(ServiceError):
    """The caller is not allowed to act as this meeting's host."""


class InvalidParticipantTransition(ServiceError):
    """The participant is not in a state that allows this host action (e.g. admitting someone already joined)."""
