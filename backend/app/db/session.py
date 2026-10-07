from collections.abc import Iterator
from contextlib import contextmanager
from sqlite3 import Connection as SQLiteConnection
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings


def _enable_foreign_keys(dbapi_connection: Any, _connection_record: Any) -> None:
    # SQLite ignores foreign keys unless this pragma is set on every connection.
    if isinstance(dbapi_connection, SQLiteConnection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()


def create_db_engine(url: str) -> Engine:
    """Engine for the given SQLite URL with foreign keys enforced on every connection.

    hide_parameters keeps bound values (passcodes, client tokens) out of
    SQLAlchemy's error messages and logs.
    """
    engine = create_engine(url, hide_parameters=True)
    event.listen(engine, "connect", _enable_foreign_keys)
    return engine


@contextmanager
def atomic(session: Session) -> Iterator[Session]:
    """Run a block as one transaction: commit if it completes, roll back everything if it raises."""
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise


engine = create_db_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine)
