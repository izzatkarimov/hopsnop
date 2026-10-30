"""Retention purge command: a dry run unless given --execute and a matching target."""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select

from app.core.config import settings
from app.db.session import SessionLocal, engine
from app.services import retention

_WIDTH = 30
_DEFAULT_PORT = 5432


def _server() -> str:
    """``host:port`` from the engine URL; nothing else of it is used."""
    url = engine.url
    return f"{(url.host or 'local').lower()}:{url.port or _DEFAULT_PORT}"


def _images() -> str:
    return str(Path(settings.image_storage_path).resolve())


def _line(name: str, value: object) -> None:
    print(f"  {name:<{_WIDTH}}{value}")


def _print_settings(database: str) -> None:
    """No secret and no password is among it."""
    _line("database", f"{database} on {_server()}")
    _line("pictures", _images())
    _line("environment", settings.environment)
    _line("rate-limit window", f"{settings.rate_limit_window_minutes} minutes")
    _line("expired stories kept", f"{settings.expired_story_retention_hours} hours")
    _line("ended sessions kept", f"{settings.ended_session_retention_days} days")
    _line("spent tokens kept", f"{settings.spent_token_retention_days} days")
    _line("finished counters kept", f"{settings.rate_limit_retention_hours} hours")
    _line(
        "unreferenced pictures kept",
        f"{settings.orphaned_image_retention_hours} hours",
    )
    _line(
        "unverified accounts",
        f"removed after {settings.unverified_account_retention_days} days"
        if settings.purge_unverified_accounts
        else "not removed (PURGE_UNVERIFIED_ACCOUNTS is off)",
    )
    _line("batch size", settings.purge_batch_size)


def _print_counts(report: retention.Report, heading: str) -> None:
    print(heading)
    for category, removed in report.as_dict().items():
        print(f"  {category.replace('_', ' '):<{_WIDTH}}{removed:>8}")
    print(f"  {'total':<{_WIDTH}}{report.total:>8}")


def _arguments(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m app.purge",
        description="Remove rows that are of no use any more (see README, "
        "Retention). Without --execute nothing is removed.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="remove the rows; without this they are only counted",
    )
    parser.add_argument(
        "--database",
        metavar="NAME",
        help="the name of the database that is meant; the command refuses "
        "if it is connected to another. Required with --execute",
    )
    parser.add_argument(
        "--host",
        metavar="HOST:PORT",
        help="the server that database is meant to be on, as the connection "
        "is made to it; the command refuses if it is connected to another. "
        "Required with --execute",
    )
    parser.add_argument(
        "--images",
        metavar="PATH",
        help="the folder of pictures that goes with that database; the "
        "command refuses if IMAGE_STORAGE_PATH names another. Required with "
        "--execute",
    )
    arguments = parser.parse_args(argv)
    if arguments.execute and not (
        arguments.database and arguments.host and arguments.images
    ):
        parser.error(
            "--execute needs --database NAME, --host HOST:PORT and --images "
            "PATH: the database that is meant, the server it is on, and the "
            "folder of pictures that goes with it"
        )
    return arguments


def main(argv: list[str] | None = None) -> int:
    arguments = _arguments(argv)
    now = datetime.now(timezone.utc)
    mode = "" if arguments.execute else " (dry run: nothing is removed)"
    print(f"Retention purge at {now.isoformat(timespec='seconds')}{mode}")
    try:
        with SessionLocal() as db:
            # Asked of the server: where the connection arrived is what matters.
            database = db.scalar(select(func.current_database()))
            db.commit()
            _print_settings(database)
            server = _server()
            images = _images()
            meant = (arguments.database, arguments.host and arguments.host.lower())
            if meant[0] not in (None, database) or meant[1] not in (None, server):
                print(
                    f"Refused: this is the database {database!r} on {server}, "
                    f"and {meant[0] or database!r} on {meant[1] or server} "
                    "was asked for. Nothing was changed.",
                    file=sys.stderr,
                )
                return 2
            if arguments.images and str(Path(arguments.images).resolve()) != images:
                print(
                    f"Refused: the pictures are in {images}, and "
                    f"{Path(arguments.images).resolve()} was asked for. "
                    "Nothing was changed.",
                    file=sys.stderr,
                )
                return 2
            if not arguments.execute:
                _print_counts(retention.pending(db, now), "Would remove:")
                print(
                    "Nothing was removed. To remove, run with "
                    f"--execute --database {database} --host {server} "
                    f"--images {images}"
                )
                return 0
            report = retention.purge(db, now)
    except retention.PurgeError as error:
        _print_counts(error.report, "Removed:")
        # Error kind only, here and below: its text can hold the connection password.
        print(
            f"Failed while removing {error.category.replace('_', ' ')} "
            f"({type(error.__cause__).__name__}). What is listed above "
            "was removed; the rest is left for the next run.",
            file=sys.stderr,
        )
        return 1
    except Exception as error:
        print(
            f"Failed before anything was removed ({type(error).__name__}).",
            file=sys.stderr,
        )
        return 1
    _print_counts(report, "Removed:")
    return 0


if __name__ == "__main__":
    sys.exit(main())
