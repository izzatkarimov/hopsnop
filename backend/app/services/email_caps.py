"""Daily caps on email, decided before anything is queued; a skip never shows."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import QueuedEmail
from app.services.rate_limit import key_hash

logger = logging.getLogger(__name__)

# Fixed, not a setting: the purge goes by it too, and cron would have to match.
WINDOW_HOURS = 24
WINDOW = timedelta(hours=WINDOW_HOURS)

# Lock order in ``erasure``. Requests take turns here: take it last, commit soon after.
EMAIL_LOCK_KEY = 0x686F70736E6F71


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _address_hash(email: str) -> str:
    return key_hash("queued-email:address", email)


def _client_hash(client: str) -> str:
    return key_hash("queued-email:client", client)


def take_place(db: Session, *, email: str, client: str | None) -> bool:
    """False if a cap is reached; no ``client``, no cap per client. Caller must commit."""
    db.execute(select(func.pg_advisory_xact_lock(EMAIL_LOCK_KEY)))
    address_hash = _address_hash(email)
    client_hash = _client_hash(client) if client is not None else None
    now = _now()
    # Own statement, begun after the lock: it sees what the last holder committed.
    total, for_address_from_client = db.execute(
        select(
            func.count(),
            func.count().filter(
                QueuedEmail.address_hash == address_hash,
                QueuedEmail.client_hash == client_hash,
            ),
        ).where(QueuedEmail.queued_at > now - WINDOW)
    ).one()
    if total >= settings.emails_per_day:
        logger.info("An email was not sent: EMAILS_PER_DAY is reached.")
        return False
    if (
        client_hash is not None
        and for_address_from_client >= settings.emails_per_address_and_ip_per_day
    ):
        logger.warning(
            "An email was not sent: EMAILS_PER_ADDRESS_AND_IP_PER_DAY is reached."
        )
        return False
    db.add(
        QueuedEmail(address_hash=address_hash, client_hash=client_hash, queued_at=now)
    )
    db.flush()
    if total + 1 >= settings.emails_per_day:
        logger.warning(
            "EMAILS_PER_DAY (%d) is reached: no email goes out until places free up.",
            settings.emails_per_day,
        )
    return True


def forget_address(db: Session, email: str) -> None:
    """Blanks, not deletes: removing the rows would hand their places back to anyone."""
    db.execute(
        update(QueuedEmail)
        .where(QueuedEmail.address_hash == _address_hash(email))
        .values(address_hash=None, client_hash=None)
    )
