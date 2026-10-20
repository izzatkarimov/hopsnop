from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


# The isolation level every transaction of the application runs at. It is
# PostgreSQL's own default, and it is named here because the application
# depends on it, not merely on whatever the server happens to be set to.
#
# At READ COMMITTED each statement sees what was committed when it began, and
# a statement that has waited for a row lock goes on with the row as its
# holder left it. That is what the locks in the services are built on: the
# request that comes second waits for the first to commit and then reads what
# the first has done (``app.services.auth._lock_account``, the redeeming of
# tokens, the counters of ``app.services.rate_limit``, and the erasing of
# posts and accounts). At a stricter level the second request would go on
# with the picture it had before it waited, and those checks would decide on
# stale data.
ISOLATION_LEVEL = "READ COMMITTED"

# The time zone of every connection. Timestamps are stored as absolute moments
# (timestamptz) either way, but PostgreSQL hands them back in the session's
# time zone, and the server's default is whatever it was installed with:
# Europe/Warsaw, say, for a server set up on a Polish machine. Python then
# does arithmetic on such values in local wall-clock time when both sides
# come from the database, so a 30-day session would last 29 days and 23 hours
# across a change to winter time, and a 60-minute edit window two hours. In
# UTC there is no such change, so the application names it here.
TIME_ZONE = "UTC"


def create_application_engine(url: str, **kwargs: object) -> Engine:
    """An engine set up the way the application's is.

    There is one engine, made below. This is a function so that how it is
    made can be tried against a server that is configured differently.
    """
    created = create_engine(
        url,
        isolation_level=ISOLATION_LEVEL,
        pool_pre_ping=True,
        # Keep statement parameters out of logs and exception messages. They
        # include password hashes and token hashes.
        hide_parameters=True,
        **kwargs,
    )
    event.listen(created, "connect", _set_time_zone)
    return created


def _set_time_zone(dbapi_connection, _connection_record) -> None:
    """Put a new connection in ``TIME_ZONE`` before it is first used.

    Run once per connection, as it is opened. The setting is made outside a
    transaction, so it holds for the connection's whole life and is not
    undone by a rollback.
    """
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