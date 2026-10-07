"""Create the SQLite database, its tables, indexes and constraints, and seed it.

Usage (from backend/):
    python -m app.db.init_db           # create anything missing, seed if empty
    python -m app.db.init_db --reset   # drop all tables and rebuild with fresh seed data

There is no migration framework. create_all() adds missing tables but never
alters an existing one. The supported upgrades, schema_2 -> schema_3 (each
user gets a Personal Meeting ID), schema_3 -> schema_4 (meetings may use it),
schema_4 -> schema_5 (participants may wait in a waiting room) and
schema_5 -> schema_6 (participants' last check-in), run automatically and
keep all data (see app.db.migrations). Any other older database (for
example one from before the meeting settings and attachments) is refused
with OutdatedDatabaseError instead of being half-upgraded; rebuild it with
--reset.
"""

import argparse
import sys
from pathlib import Path

from sqlalchemy import Engine, inspect
from sqlalchemy.orm import Session

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.db.base import Base
from app.db.migrations import upgrade_database
from app.db.seed import seed_database
from app.db.session import engine as default_engine

RESET_HINT = "python -m app.db.init_db --reset"


class OutdatedDatabaseError(RuntimeError):
    """The existing database was created from an older schema."""


def _ensure_database_directory(engine: Engine) -> None:
    database = engine.url.database
    if database and database != ":memory:":
        Path(database).parent.mkdir(parents=True, exist_ok=True)


def _outdated_tables(engine: Engine) -> list[str]:
    """Existing tables whose columns differ from the models."""
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    return [
        table.name
        for table in Base.metadata.sorted_tables
        if table.name in existing
        and [column["name"] for column in inspector.get_columns(table.name)] != [c.name for c in table.columns]
    ]


def init_db(engine: Engine | None = None, *, reset: bool = False) -> bool:
    """Create missing tables and seed an empty database.

    Existing data is kept, so this is safe to run on every startup. With
    reset=True all tables are dropped first. An older supported database is
    first upgraded in place (app.db.migrations). Returns True if seed data was
    inserted. Raises OutdatedDatabaseError, without changing anything, if
    existing tables still do not match the current schema.
    """
    engine = engine or default_engine
    _ensure_database_directory(engine)
    if reset:
        Base.metadata.drop_all(engine)
    else:
        upgrade_database(engine)
    if not reset and (outdated := _outdated_tables(engine)):
        raise OutdatedDatabaseError(
            f"The database at {engine.url.database} was created from an older schema "
            f"(table(s) {', '.join(outdated)} differ). Rebuild it with `{RESET_HINT}`; "
            "this deletes its data."
        )
    Base.metadata.create_all(engine)

    with Session(engine) as session, session.begin():
        return seed_database(session)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Create and seed the Zoom Clone database.")
    parser.add_argument("--reset", action="store_true", help="drop all tables and rebuild from scratch")
    args = parser.parse_args(argv)

    try:
        seeded = init_db(default_engine, reset=args.reset)
    except OutdatedDatabaseError as error:
        sys.exit(str(error))
    status = "seeded" if seeded else "existing data kept"
    print(f"Database ready at {default_engine.url.database} ({status})")


if __name__ == "__main__":
    main()
