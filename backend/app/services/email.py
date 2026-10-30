"""Account email; a link's raw token is logged only by the development sender."""

import html
import logging
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlencode

import httpx
from pydantic import SecretStr

from app.core.config import settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 10


class EmailSender(Protocol):
    def send_email_verification(self, *, to: str, url: str) -> None: ...

    def send_password_reset(self, *, to: str, url: str) -> None: ...


class ConsoleEmailSender:
    """Development only; WARNING so it shows with the default logging setup."""

    def send_email_verification(self, *, to: str, url: str) -> None:
        logger.warning("[development] Email verification link for %s: %s", to, url)

    def send_password_reset(self, *, to: str, url: str) -> None:
        logger.warning("[development] Password reset link for %s: %s", to, url)


@dataclass(frozen=True)
class Email:
    subject: str
    before: str
    link: str
    after: str

    @property
    def text(self) -> str:
        return f"{self.before}\n\n{self.link}\n\n{self.after}\n"

    @property
    def html(self) -> str:
        """Escaped: no images and nothing loaded from elsewhere."""
        link = html.escape(self.link)
        return (
            f"<p>{html.escape(self.before)}</p>\n"
            f'<p><a href="{link}">{link}</a></p>\n'
            f"<p>{html.escape(self.after)}</p>\n"
        )


def _counted(count: int, unit: str) -> str:
    return f"{count} {unit}" if count == 1 else f"{count} {unit}s"


def verification_email(url: str) -> Email:
    hours = settings.email_verification_token_lifetime_hours
    return Email(
        subject="Verify your Hopsnop email address",
        before="Open this link to verify your email address for Hopsnop:",
        link=url,
        after=f"The link expires in {_counted(hours, 'hour')}.",
    )


def password_reset_email(url: str) -> Email:
    minutes = settings.password_reset_token_lifetime_minutes
    return Email(
        subject="Reset your Hopsnop password",
        before="Open this link to choose a new password for your Hopsnop account:",
        link=url,
        after=(
            f"The link expires in {_counted(minutes, 'minute')}. If you didn't "
            "ask to reset your password, you can ignore this email."
        ),
    )


class ResendEmailSender:
    """Failures are logged by kind and status, not raised: the user can ask again."""

    def __init__(
        self,
        api_key: SecretStr,
        sender: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._sender = sender
        # Tests pass a mock; None is httpx's own, which reaches the network.
        self._transport = transport

    def send_email_verification(self, *, to: str, url: str) -> None:
        self._send(to, verification_email(url), "verification")

    def send_password_reset(self, *, to: str, url: str) -> None:
        self._send(to, password_reset_email(url), "password reset")

    def _send(self, to: str, email: Email, purpose: str) -> None:
        try:
            with httpx.Client(
                transport=self._transport, timeout=TIMEOUT_SECONDS
            ) as client:
                response = client.post(
                    RESEND_URL,
                    headers={
                        "Authorization": f"Bearer {self._api_key.get_secret_value()}"
                    },
                    json={
                        "from": self._sender,
                        "to": [to],
                        "subject": email.subject,
                        "text": email.text,
                        "html": email.html,
                    },
                )
        except httpx.TimeoutException:
            logger.warning("A %s email was not sent: Resend timed out.", purpose)
            return
        except httpx.HTTPError as error:
            # Class only: its message isn't this code's to vouch for.
            logger.warning(
                "A %s email was not sent: %s.", purpose, type(error).__name__
            )
            return
        if not response.is_success:
            logger.warning(
                "A %s email was not sent: Resend answered %d.",
                purpose,
                response.status_code,
            )


def get_email_sender() -> EmailSender:
    if settings.resend_api_key is not None and settings.email_from is not None:
        return ResendEmailSender(settings.resend_api_key, settings.email_from)
    if settings.is_development:
        return ConsoleEmailSender()
    # Not reached: production doesn't start without both (app.core.config).
    raise RuntimeError("RESEND_API_KEY and EMAIL_FROM are not set")


def email_verification_url(token: str) -> str:
    return f"{settings.frontend_url}/verify-email?{urlencode({'token': token})}"


def password_reset_url(token: str) -> str:
    return f"{settings.frontend_url}/reset-password?{urlencode({'token': token})}"
