"""Database-held keyed counters; ``count``, ``uncount_all``, ``forget`` commit."""

import hashlib
import hmac
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import case, delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import RateLimit


class RateLimitedError(Exception):
    status_code = 429
    detail = "Too many requests. Try again later."

    def __init__(self, retry_after: int) -> None:
        super().__init__(self.detail)
        self.retry_after = retry_after


@dataclass(frozen=True)
class Limit:
    # Part of the key, so an address is counted separately per limit; e.g. "login:ip".
    scope: str
    subject: str
    maximum: int


def _now() -> datetime:
    return datetime.now(timezone.utc)


def key_hash(scope: str, subject: str) -> str:
    secret = settings.rate_limit_secret.get_secret_value().encode("utf-8")
    # The separator can't occur in a scope, so no two pairs share a message.
    message = f"{scope}\x00{subject}".encode("utf-8")
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class Reservation:
    limit: Limit
    window_start: datetime


def count(db: Session, limit: Limit) -> Reservation:
    """Commits the session; a refused request takes nothing."""
    now = _now()
    window = settings.rate_limit_window
    key = key_hash(limit.scope, limit.subject)
    window_is_over = RateLimit.window_start <= now - window
    # No row returned: the window is still running and every place is taken.
    window_start = db.scalar(
        insert(RateLimit)
        .values(key_hash=key, window_start=now, count=1)
        .on_conflict_do_update(
            index_elements=[RateLimit.key_hash],
            set_={
                "count": case((window_is_over, 1), else_=RateLimit.count + 1),
                "window_start": case(
                    (window_is_over, now), else_=RateLimit.window_start
                ),
            },
            where=or_(window_is_over, RateLimit.count < limit.maximum),
        )
        .returning(RateLimit.window_start)
    )
    if window_start is not None:
        db.commit()
        return Reservation(limit, window_start)

    # Only to say when to come back; still locked, so this is the window found full.
    full_since = db.scalar(
        select(RateLimit.window_start).where(RateLimit.key_hash == key)
    )
    db.commit()
    remaining = (
        (full_since + window - now).total_seconds()
        if full_since is not None
        else window.total_seconds()
    )
    raise RateLimitedError(retry_after=max(1, math.ceil(remaining)))


def count_all(db: Session, limits: Sequence[Limit]) -> list[Reservation]:
    """All or none; a request the narrowest limit refuses never reaches wider ones."""
    taken: list[Reservation] = []
    try:
        for limit in limits:
            taken.append(count(db, limit))
    except RateLimitedError:
        uncount_all(db, taken)
        raise
    return taken


def uncount_all(db: Session, reservations: Sequence[Reservation]) -> None:
    """Commits. Gives back only in the same window; a newer one's counts aren't ours."""
    for reservation in reservations:
        limit = reservation.limit
        db.execute(
            update(RateLimit)
            .where(
                RateLimit.key_hash == key_hash(limit.scope, limit.subject),
                RateLimit.window_start == reservation.window_start,
                RateLimit.count > 0,
            )
            .values(count=RateLimit.count - 1)
        )
    db.commit()


def forget(db: Session, limits: Sequence[Limit]) -> None:
    """Commits. For a removed account: the name's next owner inherits no failures."""
    keys = [key_hash(limit.scope, limit.subject) for limit in limits]
    if keys:
        db.execute(delete(RateLimit).where(RateLimit.key_hash.in_(keys)))
    db.commit()
