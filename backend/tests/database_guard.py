from sqlalchemy import Connection, func, select, table
from sqlalchemy.engine import URL

import app.models  # noqa: F401  (registers every model on Base.metadata)
from app.db.base import Base

TEST_DATABASE = "hopsnop_test"

TEST_SUFFIX = "_test"


def name_refusal(url: URL) -> str | None:
    """Decided from the name alone, without connecting; no password is in it."""
    if (url.database or "").endswith(TEST_SUFFIX):
        return None
    return (
        f"\nThe tests were not run: the database "
        f"{url.database or ''!r} on {url.host}:{url.port} is not a test "
        f"database.\nThey are run only against a database whose name ends in "
        f"{TEST_SUFFIX!r}, because some of them commit and delete for real.\n"
        "Nothing was changed, and no connection was made. Point DATABASE_URL "
        "at the test database, for example:\n"
        f"  DATABASE_URL=postgresql+psycopg://…/{TEST_DATABASE} pytest\n"
        "(see README, Tests).\n"
    )


def tables_with_rows(connection: Connection) -> dict[str, int]:
    found = {}
    for name in sorted(Base.metadata.tables):
        count = connection.scalar(select(func.count()).select_from(table(name)))
        if count:
            found[name] = count
    return found


def _listed(found: dict[str, int]) -> str:
    return ", ".join(f"{name} ({count})" for name, count in found.items())


def refusal(found: dict[str, int], url: URL) -> str:
    return (
        f"\nThe tests were not run: the database "
        f"{url.database!r} on {url.host}:{url.port} is not empty.\n"
        f"  Rows found in: {_listed(found)}\n"
        "The tests assume empty tables, and some of them commit and delete "
        "for real.\nNothing was changed. Point DATABASE_URL at an empty, "
        "migrated database, for example:\n"
        f"  DATABASE_URL=postgresql+psycopg://…/{TEST_DATABASE} pytest\n"
        "(see README, Tests).\n"
    )


def leak_report(found: dict[str, int]) -> str:
    return (
        "Rows were left in the database by this test run: "
        f"{_listed(found)}. A test that commits did not remove what it "
        "wrote. The next run will be refused until they are gone."
    )
