from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


# Named because the locks rely on it: after waiting, a statement sees what the holder
# committed. A stricter level would decide on stale data.
ISOLATION_LEVEL = "READ COMMITTED"

# Otherwise timestamps come back in the server's zone and arithmetic breaks across DST.
TIME_ZONE = "UTC"


def create_application_engine(url: str, **kwargs: object) -> Engine:
    """A function so it can be tried against a differently configured server."""
    created = create_engine(
        url,
        isolation_level=ISOLATION_LEVEL,
        pool_pre_ping=True,
        # Parameters include password and token hashes.
        hide_parameters=True,
        **kwargs,
    )
    event.listen(created, "connect", _set_time_zone)
    return created


def _set_time_zone(dbapi_connection, _connection_record) -> None:
    """Set outside a transaction, so a rollback doesn't undo it."""
    autocommit = dbapi_connection.autocommit
    dbapi_connection.autocommit = True
    try:
        with dbapi_connection.cursor() as cursor:
            cursor.execute(f"SET TIME ZONE '{TIME_ZONE}'")
    finally:
        dbapi_connection.autocommit = autocommit


engine = create_application_engine(settings.database_url)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)