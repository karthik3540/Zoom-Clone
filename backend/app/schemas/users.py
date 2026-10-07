"""Request and response models of POST /api/users/identify."""

import re

from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator

# A pragmatic shape check (something@domain.tld, no spaces); deliverability is not checked.
EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s.]+(\.[^@\s.]+)+")
MAX_EMAIL_LENGTH = 254


class IdentifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: StrictStr = Field(description="The user's email address; surrounding whitespace is ignored")

    @field_validator("email")
    @classmethod
    def _valid_email(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Email is required")
        if len(value) > MAX_EMAIL_LENGTH or not EMAIL_PATTERN.fullmatch(value):
            raise ValueError("Enter a valid email address")
        return value


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str
    personal_meeting_id: str = Field(
        description="The user's permanent 10-digit Personal Meeting ID (a string: leading zeros are kept)"
    )


class IdentifyResponse(UserOut):
    is_new: bool = Field(description="True when this request created the user")
