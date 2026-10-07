"""Column definitions repeated across tables in schema_6.sql."""

from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, Column, Integer, Text, text
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import MappedColumn, mapped_column
from sqlalchemy.schema import CreateColumn
from sqlalchemy.sql.compiler import DDLCompiler

from app.db.types import IntBool, UTCTimestamp, utc_now

DEFAULT_TIMEZONE = "Asia/Kolkata"


def rowid_primary_key() -> MappedColumn[int]:
    """`id INTEGER PRIMARY KEY`: an alias for SQLite's rowid, assigned by SQLite."""
    return mapped_column(Integer, primary_key=True)


def _is_rowid_alias(column: Column[Any]) -> bool:
    return (
        column.primary_key
        and len(column.table.primary_key.columns) == 1
        and type(column.type) is Integer
    )


@compiles(CreateColumn, "sqlite")
def _rowid_alias_without_not_null(create: CreateColumn[Any], compiler: DDLCompiler, **kw: Any) -> str:
    # SQLAlchemy declares primary keys as `INTEGER NOT NULL`, while schema_6.sql
    # declares `id INTEGER PRIMARY KEY`. Both are rowid aliases that SQLite
    # never leaves NULL, but PRAGMA table_info reports notnull differently, so
    # the redundant NOT NULL is dropped to reproduce the frozen schema exactly.
    ddl = compiler.visit_create_column(create, **kw)
    if ddl and _is_rowid_alias(create.element):
        ddl = ddl.replace(" NOT NULL", "", 1)
    return ddl


def flag_column(name: str, *, default: bool) -> MappedColumn[bool]:
    """`<name> INTEGER NOT NULL DEFAULT 0|1 CHECK (<name> IN (0, 1))`, exposed as bool."""
    return mapped_column(
        IntBool,
        CheckConstraint(f"{name} IN (0, 1)"),
        nullable=False,
        default=default,
        server_default=text(str(int(default))),
    )


def display_name_column() -> MappedColumn[str]:
    return mapped_column(Text, CheckConstraint("length(trim(display_name)) > 0"), nullable=False)


def timezone_column() -> MappedColumn[str]:
    """IANA timezone name."""
    return mapped_column(Text, nullable=False, default=DEFAULT_TIMEZONE, server_default=DEFAULT_TIMEZONE)


def created_at_column() -> MappedColumn[datetime]:
    return mapped_column(
        UTCTimestamp, nullable=False, default=utc_now, server_default=text("CURRENT_TIMESTAMP")
    )


def updated_at_column() -> MappedColumn[datetime]:
    # SQLite never refreshes this column by itself; the ORM does on every UPDATE.
    return mapped_column(
        UTCTimestamp,
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
        server_default=text("CURRENT_TIMESTAMP"),
    )
