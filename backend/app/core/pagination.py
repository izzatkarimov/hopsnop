"""Keyset pagination; cursors aren't secret, so order only by what a page shows."""

import base64
import struct
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Generic, Protocol, TypeVar

from sqlalchemy import Select, tuple_
from sqlalchemy.orm import Mapped, Session

DEFAULT_PAGE_SIZE = 20
# Caps what one request can make the server load.
MAX_PAGE_SIZE = 50

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_MICROSECOND = timedelta(microseconds=1)
# Microseconds since the epoch (PostgreSQL's precision), then the 16 id bytes.
_LAYOUT = struct.Struct(">q16s")
# 24 bytes are exactly 32 base64 characters, with no padding.
_ENCODED_LENGTH = 32


class InvalidCursorError(ValueError):
    """The value is not a cursor produced by ``encode_cursor``."""


@dataclass(frozen=True)
class Cursor:
    created_at: datetime
    id: uuid.UUID


def encode_cursor(cursor: Cursor) -> str:
    microseconds = (cursor.created_at - _EPOCH) // _MICROSECOND
    packed = _LAYOUT.pack(microseconds, cursor.id.bytes)
    return base64.urlsafe_b64encode(packed).decode("ascii")


def decode_cursor(value: str) -> Cursor:
    if len(value) != _ENCODED_LENGTH:
        raise InvalidCursorError
    try:
        packed = base64.b64decode(value, altchars=b"-_", validate=True)
        microseconds, id_bytes = _LAYOUT.unpack(packed)
        created_at = _EPOCH + microseconds * _MICROSECOND
    except (ValueError, struct.error, OverflowError):
        # Not base64, not the right size, or a time no datetime can hold.
        raise InvalidCursorError from None
    cursor = Cursor(created_at=created_at, id=uuid.UUID(bytes=id_bytes))
    # The decoder also takes standard base64; re-encoding gives one cursor per position.
    if encode_cursor(cursor) != value:
        raise InvalidCursorError
    return cursor


class _Ordered(Protocol):
    created_at: Mapped[datetime]


_Row = TypeVar("_Row", bound=_Ordered)


@dataclass(frozen=True)
class Page(Generic[_Row]):
    items: Sequence[_Row]
    next_cursor: str | None


def paginate(
    db: Session,
    statement: Select[tuple[_Row]],
    model: type[_Row],
    *,
    limit: int,
    after: Cursor | None = None,
    tiebreaker: str = "id",
) -> Page[_Row]:
    """``tiebreaker`` must be a UUID unique among ``statement``'s rows."""
    created_at, unique = model.created_at, getattr(model, tiebreaker)
    if after is not None:
        # Row comparison: strictly after the cursor's row.
        statement = statement.where(
            tuple_(created_at, unique) < (after.created_at, after.id)
        )
    rows = db.scalars(
        statement.order_by(created_at.desc(), unique.desc())
        # One extra row, only to learn whether a next page exists.
        .limit(limit + 1)
    ).all()

    items = rows[:limit]
    has_more = len(rows) > limit
    next_cursor = (
        encode_cursor(
            Cursor(
                created_at=items[-1].created_at,
                id=getattr(items[-1], tiebreaker),
            )
        )
        if has_more
        else None
    )
    return Page(items=items, next_cursor=next_cursor)
