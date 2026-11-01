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

    def send_registration_notice(self, *, to: str) -> None: ...


class ConsoleEmailSender:
    """Development only; WARNING so it shows with the default logging setup."""

    def send_email_verification(self, *, to: str, url: str) -> None:
        logger.warning("[development] Email verification link for %s: %s", to, url)

    def send_password_reset(self, *, to: str, url: str) -> None:
        logger.warning("[development] Password reset link for %s: %s", to, url)

    def send_registration_notice(self, *, to: str) -> None:
        logger.warning("[development] Registration notice for %s", to)


class Link(str):
    """A paragraph of an email that is a link."""


def _html_paragraph(paragraph: str) -> str:
    escaped = html.escape(paragraph)
    if isinstance(paragraph, Link):
        return f'<p><a href="{escaped}">{escaped}</a></p>\n'
    return f"<p>{escaped}</p>\n"


@dataclass(frozen=True)
class Email:
    subject: str
    paragraphs: tuple[str, ...]

    @property
    def text(self) -> str:
        return "\n\n".join(self.paragraphs) + "\n"

    @property
    def html(self) -> str:
        """Escaped: no images and nothing loaded from elsewhere."""
        return "".join(_html_paragraph(paragraph) for paragraph in self.paragraphs)


def _counted(count: int, unit: str) -> str:
    return f"{count} {unit}" if count == 1 else f"{count} {unit}s"


def verification_email(url: str) -> Email:
    hours = settings.email_verification_token_lifetime_hours
    return Email(
        subject="Verify your Hopsnop email address",
        paragraphs=(
            "Open this link to verify your email address for Hopsnop:",
            Link(url),
            f"The link expires in {_counted(hours, 'hour')}.",
        ),
    )


def password_reset_email(url: str) -> Email:
    minutes = settings.password_reset_token_lifetime_minutes
    return Email(
        subject="Reset your Hopsnop password",
        paragraphs=(
            "Open this link to choose a new password for your Hopsnop account:",
            Link(url),
            f"The link expires in {_counted(minutes, 'minute')}. If you didn't "
            "ask to reset your password, you can ignore this email.",
        ),
    )


def registration_notice_email() -> Email:
    # Nothing from the request: registering mustn't deliver anyone's words to any inbox.
    return Email(
        subject="Someone tried to register with your Hopsnop email address",
        paragraphs=(
            "Someone tried to create a Hopsnop account with this email address, "
            "which already has one. No new account was created and nothing was "
            "changed.",
            "If that was you, you can log in:",
            Link(login_url()),
            "If you have forgotten your password, you can reset it:",
            Link(forgot_password_url()),
            "If you never verified this address, logging in will show you how. "
            "If it wasn't you, you can ignore this email.",
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

    def send_registration_notice(self, *, to: str) -> None:
        self._send(to, registration_notice_email(), "registration notice")

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


def login_url() -> str:
    return f"{settings.frontend_url}/login"


def forgot_password_url() -> str:
    return f"{settings.frontend_url}/forgot-password"
