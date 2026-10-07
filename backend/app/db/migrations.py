"""One-time upgrades of an existing database to the current schema.

There is no migration framework. init_db() calls upgrade_database() before
it compares the tables with the models; each upgrade recognizes exactly one
older shape and converts it inside a single transaction, so a database is
never left half-converted. Upgrades run in order, so a schema_2 database
goes through both. Anything not recognized is left untouched (init_db then
refuses it with OutdatedDatabaseError, as before).

schema_2 -> schema_3: users gains personal_meeting_id (TEXT NOT NULL UNIQUE,
exactly 10 digits). SQLite cannot add a NOT NULL UNIQUE column to a table
that has rows, so users is rebuilt with SQLite's documented procedure:
foreign keys off, create the new table, copy every row with its new PMI,
drop the old table, rename, check foreign keys, commit. Row ids, emails,
names and timestamps are copied unchanged, so meetings, participants and
attachments (which reference users by id) are untouched. The seed users get
their fixed seed PMIs; every other user gets a random one.

schema_3 -> schema_4: meetings gains meeting_id_type (NOT NULL DEFAULT
'generated', so every existing meeting keeps being joined by its own code),
added with ALTER TABLE, plus the index uq_meetings_one_live_personal_per_host.

schema_4 -> schema_5: meeting_participants accepts status 'waiting'. Its
columns do not change, but its CHECKs and one partial index do, which SQLite
cannot alter, so the table is rebuilt (same procedure as users) and its
indexes recreated. Every row is copied unchanged, ids included.

schema_5 -> schema_6: meeting_participants gains last_seen_at (NOT NULL
DEFAULT CURRENT_TIMESTAMP), which ALTER TABLE cannot add, so the table is
rebuilt the same way; every row starts as seen at the upgrade. A schema_4
database gets both changes from that one rebuild.
"""

import sqlite3
from collections.abc import Callable
from typing import Any

from sqlalchemy import Engine, Table, inspect
from sqlalchemy.schema import CreateColumn, CreateIndex, CreateTable

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.db.base import Base
from app.db.seed import SEED_PERSONAL_MEETING_IDS
from app.models import Meeting, MeetingParticipant, User
from app.services.personal_meeting_id import generate_personal_meeting_id

# Column lists of the older revisions (fixed history, not derived from the models).
SCHEMA_2_USER_COLUMNS = [
    "id", "email", "display_name", "avatar_url", "password_hash", "timezone", "created_at", "updated_at",
]
SCHEMA_3_MEETING_COLUMNS = [  # also schema_2's
    "id", "meeting_code", "host_id", "title", "description", "meeting_type", "status", "scheduled_start_at",
    "duration_minutes", "timezone", "passcode", "waiting_room_enabled", "encryption_mode", "notes_enabled",
    "notes_scope", "host_video_enabled", "participant_video_enabled", "template", "started_at", "ended_at",
    "created_at", "updated_at",
]
SCHEMA_5_PARTICIPANT_COLUMNS = [  # unchanged from schema_1 to schema_5
    "id", "meeting_id", "user_id", "client_token", "display_name", "role", "status", "is_muted", "is_video_on",
    "joined_at", "left_at",
]
PERSONAL_MEETING_INDEX = "uq_meetings_one_live_personal_per_host"


def upgrade_database(engine: Engine) -> list[str]:
    """Apply every pending upgrade, in order, and return the names of those applied."""
    applied = []
    old_participants = {"meeting_participants": SCHEMA_5_PARTICIPANT_COLUMNS}
    if _has_columns(engine, {"users": SCHEMA_2_USER_COLUMNS, "meetings": SCHEMA_3_MEETING_COLUMNS, **old_participants}):
        _add_personal_meeting_ids(engine)
        applied.append("schema_2 -> schema_3: users.personal_meeting_id")
    if _has_columns(engine, {"meetings": SCHEMA_3_MEETING_COLUMNS, **old_participants}):
        _add_meeting_id_type(engine)
        applied.append("schema_3 -> schema_4: meetings.meeting_id_type")
    if _has_columns(engine, old_participants):
        if _participants_lack_waiting(engine):
            applied.append("schema_4 -> schema_5: meeting_participants.status 'waiting'")
        _rebuild_participants(engine)
        applied.append("schema_5 -> schema_6: meeting_participants.last_seen_at")
    return applied


def _has_columns(engine: Engine, older: dict[str, list[str]]) -> bool:
    """The tables in `older` have exactly those columns; every other existing table is already current."""
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    if not set(older) <= existing:
        return False
    return all(
        [c["name"] for c in inspector.get_columns(table.name)] == older.get(table.name, [c.name for c in table.columns])
        for table in Base.metadata.sorted_tables
        if table.name in existing
    )


def _rebuild_table(conn: sqlite3.Connection, engine: Engine, table: Table, columns: list[str]) -> None:
    """Recreate `table` from the models with the same name and rows: create, copy, drop, rename, re-index.

    Needs foreign keys off (see _in_one_transaction), so dropping the old
    table does not cascade to the rows that reference it.
    """
    create_new = str(CreateTable(table).compile(dialect=engine.dialect)).strip()
    prefix = f"CREATE TABLE {table.name} "
    if not create_new.startswith(prefix):
        raise RuntimeError(f"Unexpected {table.name} DDL: {create_new[:40]!r}")
    conn.execute(create_new.replace(prefix, f"CREATE TABLE {table.name}_new ", 1))
    column_list = ", ".join(columns)
    conn.execute(f"INSERT INTO {table.name}_new ({column_list}) SELECT {column_list} FROM {table.name}")
    conn.execute(f"DROP TABLE {table.name}")  # its indexes go with it
    conn.execute(f"ALTER TABLE {table.name}_new RENAME TO {table.name}")
    for index in sorted(table.indexes, key=lambda i: i.name or ""):
        conn.execute(str(CreateIndex(index).compile(dialect=engine.dialect)))


def _in_one_transaction(engine: Engine, work: Callable[[sqlite3.Connection], None], *, foreign_keys: bool) -> None:
    """Run `work` between an explicit BEGIN IMMEDIATE and COMMIT (DDL included), rolling back on any error."""
    raw = engine.raw_connection()
    conn: sqlite3.Connection = raw.driver_connection  # type: ignore[assignment]
    isolation_level = conn.isolation_level
    conn.isolation_level = None  # explicit BEGIN/COMMIT below
    try:
        if not foreign_keys:
            conn.execute("PRAGMA foreign_keys = OFF")  # only takes effect outside a transaction
        conn.execute("BEGIN IMMEDIATE")
        try:
            work(conn)
            if conn.execute("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("The upgrade would break foreign keys; nothing was changed.")
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.isolation_level = isolation_level
        raw.close()


# --- schema_2 -> schema_3 -------------------------------------------------------------------


def _assign_personal_meeting_ids(rows: list[tuple[Any, ...]]) -> dict[int, str]:
    """One unique PMI per user id: the fixed one for an unchanged seed user, otherwise random."""
    assigned = {
        user_id: SEED_PERSONAL_MEETING_IDS[user_id, email]
        for user_id, email, *_ in rows
        if (user_id, email) in SEED_PERSONAL_MEETING_IDS
    }
    used = set(assigned.values())
    for user_id, *_ in rows:
        if user_id in assigned:
            continue
        pmi = generate_personal_meeting_id()
        while pmi in used:
            pmi = generate_personal_meeting_id()
        assigned[user_id] = pmi
        used.add(pmi)
    return assigned


def _add_personal_meeting_ids(engine: Engine) -> None:
    create_new = str(CreateTable(User.__table__).compile(dialect=engine.dialect)).strip()
    if not create_new.startswith("CREATE TABLE users "):
        raise RuntimeError(f"Unexpected users DDL: {create_new[:40]!r}")
    create_new = create_new.replace("CREATE TABLE users ", "CREATE TABLE users_new ", 1)
    old_columns = ", ".join(SCHEMA_2_USER_COLUMNS)

    def rebuild_users(conn: sqlite3.Connection) -> None:
        rows = conn.execute(f"SELECT {old_columns} FROM users ORDER BY id").fetchall()
        pmis = _assign_personal_meeting_ids(rows)
        conn.execute(create_new)
        conn.executemany(
            f"INSERT INTO users_new ({old_columns}, personal_meeting_id)"
            f" VALUES ({', '.join('?' * len(SCHEMA_2_USER_COLUMNS))}, ?)",
            [(*row, pmis[row[0]]) for row in rows],
        )
        conn.execute("DROP TABLE users")
        conn.execute("ALTER TABLE users_new RENAME TO users")

    # With foreign keys off, dropping the old users table does not cascade to
    # meetings or null out participants.
    _in_one_transaction(engine, rebuild_users, foreign_keys=False)


# --- schema_3 -> schema_4 -------------------------------------------------------------------


def _add_meeting_id_type(engine: Engine) -> None:
    meetings = Meeting.__table__
    column = str(CreateColumn(meetings.c.meeting_id_type).compile(dialect=engine.dialect)).strip()
    index = next(i for i in meetings.indexes if i.name == PERSONAL_MEETING_INDEX)
    create_index = str(CreateIndex(index).compile(dialect=engine.dialect)).strip()

    def add_column(conn: sqlite3.Connection) -> None:
        conn.execute(f"ALTER TABLE meetings ADD COLUMN {column}")
        conn.execute(create_index)

    _in_one_transaction(engine, add_column, foreign_keys=True)


# --- schema_4 -> schema_5 -> schema_6 ----------------------------------------------------------


def _participants_lack_waiting(engine: Engine) -> bool:
    """meeting_participants exists and its status CHECK predates 'waiting'."""
    with engine.connect() as conn:
        sql = conn.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'meeting_participants'"
        ).scalar()
    return sql is not None and "'waiting'" not in sql


def _rebuild_participants(engine: Engine) -> None:
    """Rebuild meeting_participants from the model ('waiting' status, last_seen_at), copying every row."""
    table = MeetingParticipant.__table__

    def rebuild(conn: sqlite3.Connection) -> None:
        _rebuild_table(conn, engine, table, SCHEMA_5_PARTICIPANT_COLUMNS)

    _in_one_transaction(engine, rebuild, foreign_keys=False)
