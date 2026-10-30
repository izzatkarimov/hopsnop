"""Removes rows of no use in batches; SKIP LOCKED, so it never waits on a row."""

from collections.abc import Iterator
from dataclasses import dataclass, fields
from datetime import datetime

from sqlalchemy import ColumnElement, delete, exists, func, or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.core.config import settings
from app.core.image_store import image_store
from app.models import (
    EmailVerificationToken,
    PasswordResetToken,
    Post,
    RateLimit,
    Story,
    User,
    UserSession,
)
from app.services import erasure

_Conditions = tuple[ColumnElement[bool], ...]


@dataclass
class Report:
    unverified_accounts: int = 0
    expired_stories: int = 0
    ended_sessions: int = 0
    email_verification_tokens: int = 0
    password_reset_tokens: int = 0
    rate_limit_counters: int = 0
    orphaned_pictures: int = 0

    @property
    def total(self) -> int:
        return sum(self.as_dict().values())

    def as_dict(self) -> dict[str, int]:
        return {field.name: getattr(self, field.name) for field in fields(self)}


class PurgeError(Exception):
    """``report`` is what was committed before the failure; the cause is chained."""

    def __init__(self, category: str, report: Report) -> None:
        super().__init__(f"The purge failed while removing {category}.")
        self.category = category
        self.report = report


# Which rows are removed is decided here and nowhere else.


def _expired_stories(now: datetime) -> _Conditions:
    return (Story.expires_at <= now - settings.expired_story_retention,)


def _ended_sessions(now: datetime) -> _Conditions:
    cutoff = now - settings.ended_session_retention
    return (or_(UserSession.expires_at <= cutoff, UserSession.revoked_at <= cutoff),)


def _spent(
    model: type[EmailVerificationToken] | type[PasswordResetToken], now: datetime
) -> _Conditions:
    cutoff = now - settings.spent_token_retention
    return (or_(model.expires_at <= cutoff, model.used_at <= cutoff),)


def _finished_counters(now: datetime) -> _Conditions:
    # Over once it began a window ago (``rate_limit.count``).
    window_over_since = now - settings.rate_limit_window
    return (
        RateLimit.window_start <= window_over_since - settings.rate_limit_retention,
    )


def _abandoned(now: datetime) -> _Conditions:
    link = EmailVerificationToken
    return (
        User.email_verified_at.is_(None),
        User.is_active.is_(True),
        User.created_at <= now - settings.unverified_account_retention,
        ~exists().where(
            link.user_id == User.id, link.used_at.is_(None), link.expires_at > now
        ),
        ~exists().where(Post.author_id == User.id),
        ~exists().where(Story.author_id == User.id),
        ~exists().where(UserSession.user_id == User.id),
    )


def _remove_rows(
    db: Session,
    key: InstrumentedAttribute,
    of_no_use: _Conditions,
    *,
    among_erasures: bool = False,
    pictures: InstrumentedAttribute | None = None,
) -> Iterator[int]:
    """Matching is decided under lock; held rows are skipped; files go after commit."""
    while True:
        if among_erasures:
            erasure.lock_erasure(db)
        keys = db.scalars(
            select(key)
            .where(*of_no_use)
            .limit(settings.purge_batch_size)
            .with_for_update(skip_locked=True)
        ).all()
        if not keys:
            # Also gives the erasure lock back.
            db.commit()
            return
        removed = delete(key.class_).where(key.in_(keys))
        if pictures is None:
            db.execute(removed, execution_options={"synchronize_session": False})
            db.commit()
        else:
            files = db.scalars(
                removed.returning(pictures),
                execution_options={"synchronize_session": False},
            ).all()
            db.commit()
            image_store().delete(files)
        yield len(keys)


def _remove_accounts(db: Session, now: datetime) -> Iterator[int]:
    """One transaction per account; one passed over isn't retried in this run."""
    after = None
    while True:
        found = select(User.id).where(*_abandoned(now))
        if after is not None:
            found = found.where(User.id > after)
        user_ids = db.scalars(
            found.order_by(User.id).limit(settings.purge_batch_size)
        ).all()
        db.commit()
        if not user_ids:
            return
        after = user_ids[-1]
        for user_id in user_ids:
            if _remove_account(db, user_id, now):
                yield 1


def _remove_account(db: Session, user_id: object, now: datetime) -> bool:
    held = db.scalar(
        select(User.id).where(User.id == user_id).with_for_update(skip_locked=True)
    )
    # Own statement, begun after the lock: it sees a link issued or opened meanwhile.
    if held is None or not db.scalar(
        select(exists().where(User.id == user_id, *_abandoned(now)))
    ):
        db.commit()
        return False
    pictures = erasure.erase_account(db, user_id, now)
    db.commit()
    image_store().delete(pictures)
    return True


def _orphaned_pictures(db: Session, now: datetime) -> list[str]:
    """No locks: rows are only written for new files, so an old orphan stays one."""
    cutoff = now - settings.orphaned_image_retention
    old_enough = {
        stored.name: stored.image_id
        for stored in image_store().files()
        if stored.image_id is not None and stored.modified_at <= cutoff
    }
    referred_to: set = set()
    ids = list(set(old_enough.values()))
    for start in range(0, len(ids), settings.purge_batch_size):
        batch = ids[start : start + settings.purge_batch_size]
        referred_to.update(db.scalars(select(User.avatar_id).where(User.avatar_id.in_(batch))))
        referred_to.update(db.scalars(select(Story.media_id).where(Story.media_id.in_(batch))))
    db.commit()
    return [name for name, image_id in old_enough.items() if image_id not in referred_to]


def _remove_orphaned_pictures(db: Session, now: datetime) -> Iterator[int]:
    names = _orphaned_pictures(db, now)
    store = image_store()
    for start in range(0, len(names), settings.purge_batch_size):
        yield sum(
            store.remove_file(name)
            for name in names[start : start + settings.purge_batch_size]
        )


_ACCOUNTS = "unverified_accounts"


_Rows = tuple[InstrumentedAttribute, _Conditions, bool, InstrumentedAttribute | None]


def _rows_of_no_use(now: datetime) -> dict[str, _Rows]:
    return {
        "expired_stories": (Story.id, _expired_stories(now), True, Story.media_id),
        "ended_sessions": (UserSession.id, _ended_sessions(now), False, None),
        "email_verification_tokens": (
            EmailVerificationToken.id,
            _spent(EmailVerificationToken, now),
            False,
            None,
        ),
        "password_reset_tokens": (
            PasswordResetToken.id,
            _spent(PasswordResetToken, now),
            False,
            None,
        ),
        "rate_limit_counters": (
            RateLimit.key_hash,
            _finished_counters(now),
            False,
            None,
        ),
    }


def purge(db: Session, now: datetime) -> Report:
    """Commits per batch, so give it a session with no changes of its own."""
    report = Report()

    def count(category: str, batches: Iterator[int]) -> None:
        try:
            for removed in batches:
                setattr(report, category, getattr(report, category) + removed)
        except Exception as error:
            db.rollback()
            raise PurgeError(category, report) from error

    # Accounts first: their tokens go with them.
    if settings.purge_unverified_accounts:
        count(_ACCOUNTS, _remove_accounts(db, now))
    for category, (key, of_no_use, among_erasures, pictures) in _rows_of_no_use(
        now
    ).items():
        count(
            category,
            _remove_rows(
                db, key, of_no_use, among_erasures=among_erasures, pictures=pictures
            ),
        )
    # Last: what the rows above named is gone, and what's left no row names.
    count("orphaned_pictures", _remove_orphaned_pictures(db, now))
    return report


def pending(db: Session, now: datetime) -> Report:
    """Read-only; a real run can remove fewer, if rows are held or used meanwhile."""
    report = Report()
    found = {
        category: (key.class_, of_no_use)
        for category, (key, of_no_use, _, _) in _rows_of_no_use(now).items()
    }
    if settings.purge_unverified_accounts:
        found[_ACCOUNTS] = (User, _abandoned(now))
    for category, (model, of_no_use) in found.items():
        matching = select(func.count()).select_from(model).where(*of_no_use)
        setattr(report, category, db.scalar(matching))
    # Only ends the counting's transaction; nothing is in it.
    db.commit()
    report.orphaned_pictures = len(_orphaned_pictures(db, now))
    return report
