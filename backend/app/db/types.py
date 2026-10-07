"""Column types that control exactly how values are stored in SQLite.

Timestamps: schema_6.sql stores every timestamp as UTC text in the form
'YYYY-MM-DD HH:MM:SS' and compares them as strings (in CHECKs and
ORDER BYs), which is only correct when every value has that same format.
`UTCTimestamp` is the single code path that turns Python datetimes into
that text and back, and `utc_now()` is the single source of "now".
"""

import re
from datetime import UTC, datetime

from sqlalchemy import Integer, Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator

TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"
TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")


def utc_now() -> datetime:
    """Current UTC time, truncated to whole seconds like the stored format."""
    return datetime.now(UTC).replace(microsecond=0)


def format_timestamp(value: datetime) -> str:
    """Render an aware datetime as stored text. Naive datetimes are rejected."""
    if not isinstance(value, datetime):
        raise TypeError(f"Expected a datetime, got {type(value).__name__}")
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Naive datetimes are ambiguous; pass a timezone-aware datetime")
    return value.astimezone(UTC).strftime(TIMESTAMP_FORMAT)


def parse_timestamp(value: str) -> datetime:
    """Parse stored text back into an aware UTC datetime."""
    if not TIMESTAMP_PATTERN.match(value):
        raise ValueError(f"Timestamp {value!r} is not in 'YYYY-MM-DD HH:MM:SS' format")
    return datetime.strptime(value, TIMESTAMP_FORMAT).replace(tzinfo=UTC)


class UTCTimestamp(TypeDecorator[datetime]):
    """TEXT column holding a UTC 'YYYY-MM-DD HH:MM:SS' timestamp."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> str | None:
        return None if value is None else format_timestamp(value)

    def process_result_value(self, value: str | None, dialect: Dialect) -> datetime | None:
        return None if value is None else parse_timestamp(value)


class IntBool(TypeDecorator[bool]):
    """INTEGER column restricted to 0/1 (by a CHECK), exposed to Python as bool.

    SQLAlchemy's Boolean type would declare the column as BOOLEAN; the
    frozen schema declares INTEGER.
    """

    impl = Integer
    cache_ok = True

    def process_bind_param(self, value: bool | None, dialect: Dialect) -> int | None:
        if value is None:
            return None
        if value not in (0, 1):  # True/False compare equal to 1/0
            raise ValueError(f"Expected a bool, got {value!r}")
        return int(value)

    def process_result_value(self, value: int | None, dialect: Dialect) -> bool | None:
        return None if value is None else bool(value)
