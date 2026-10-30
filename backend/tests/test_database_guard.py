import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy.engine import URL, make_url

from database_guard import name_refusal

REPOSITORY = Path(__file__).resolve().parent.parent

PASSWORD = "a-secret-password"
USER = "someone"


def url_for(database: str | None) -> URL:
    return URL.create(
        "postgresql+psycopg",
        username=USER,
        password=PASSWORD,
        host="db.example.com",
        port=5433,
        database=database,
    )


@pytest.mark.parametrize("database", ["hopsnop_test", "ci_test"])
def test_database_named_as_a_test_database_is_accepted(database: str) -> None:
    assert name_refusal(url_for(database)) is None


@pytest.mark.parametrize(
    "database",
    ["hopsnop", "hopsnop_test2", "hopsnop_testing", "test", "HOPSNOP_TEST", "postgres"],
)
def test_database_not_named_as_a_test_database_is_refused(database: str) -> None:
    message = name_refusal(url_for(database))

    assert message is not None
    assert f"{database!r}" in message
    assert "db.example.com:5433" in message
    assert "Nothing was changed" in message
    assert "DATABASE_URL=postgresql+psycopg://…/hopsnop_test pytest" in message
    assert PASSWORD not in message
    assert USER not in message


@pytest.mark.parametrize("database", ["", None])
def test_url_without_a_database_name_is_refused(database: str | None) -> None:
    message = name_refusal(url_for(database))

    assert message is not None
    assert "db.example.com:5433" in message
    assert PASSWORD not in message
    assert USER not in message


def test_password_in_a_parsed_url_is_not_in_the_refusal() -> None:
    url = make_url(f"postgresql+psycopg://hopsnop:{PASSWORD}@localhost:5433/hopsnop")

    message = name_refusal(url)

    assert message is not None
    assert PASSWORD not in message


def test_run_against_a_database_not_named_for_tests_is_refused_unconnected() -> None:
    # Nothing listens on port 1: a connection attempt would end the run differently.
    environment = {
        **os.environ,
        "DATABASE_URL": f"postgresql+psycopg://hopsnop:{PASSWORD}@localhost:1/hopsnop",
        "ENVIRONMENT": "development",
    }
    run = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/test_models.py", "-q"]
        + ["-p", "no:cacheprovider"],
        cwd=REPOSITORY,
        env=environment,
        capture_output=True,
        text=True,
        timeout=120,
    )

    output = run.stdout + run.stderr
    assert run.returncode == 2
    assert "The tests were not run" in output
    assert "'hopsnop' on localhost:1 is not a test database" in output
    assert "could not be checked" not in output
    assert " passed" not in output and " failed" not in output
    assert PASSWORD not in output
