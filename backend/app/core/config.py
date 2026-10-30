from datetime import timedelta
from email.utils import parseaddr
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Development-only defaults; production refuses to start with either.
_DEVELOPMENT_FRONTEND_URL = "http://localhost:3000"
_DEVELOPMENT_RATE_LIMIT_SECRET = "development-only-rate-limit-secret"
_RATE_LIMIT_SECRET_MIN_LENGTH = 32
# The account login limit must be this many times the per-address limit.
_ACCOUNT_TO_ADDRESS_LIMIT_RATIO = 3


class Settings(BaseSettings):
    database_url: str

    # Default on purpose: forgetting ENVIRONMENT gets the strict behaviour.
    environment: Literal["development", "production"] = "production"

    # Trusted for CORS/CSRF, so production must set it (https).
    frontend_url: str | None = None

    # Production requires both; development logs the links unless both are set.
    resend_api_key: SecretStr | None = None
    # As Resend takes it: "Hopsnop <no-reply@hopsnop.com>".
    email_from: str | None = None

    # Without its prefix; see ``session_cookie``.
    session_cookie_name: str = "hopsnop_session"
    # "none" isn't an option: the CSRF defence relies on SameSite withholding it.
    session_cookie_samesite: Literal["lax", "strict"] = "lax"

    session_lifetime_days: int = Field(default=30, gt=0)
    # Written at most once per interval, so a request rarely costs a database write.
    session_last_used_interval_seconds: int = Field(default=300, ge=0)
    email_verification_token_lifetime_hours: int = Field(default=24, gt=0)
    password_reset_token_lifetime_minutes: int = Field(default=30, gt=0)

    # Length is the only rule; the floor stops configuration from gutting it.
    password_min_length: int = Field(default=12, ge=8)

    # HMAC key, so counters hold no addresses or identifiers; required in production.
    rate_limit_secret: SecretStr | None = None
    # A counter resets this long after its first request.
    rate_limit_window_minutes: int = Field(default=15, gt=0)
    # The account limit must be at least 3x this (checked below): unaligned windows
    # let one address reach 2x its limit, and the owner must still have attempts left.
    login_failures_per_identifier_and_ip: int = Field(default=5, gt=0)
    login_failures_per_identifier: int = Field(default=20, gt=0)
    login_failures_per_ip: int = Field(default=30, gt=0)
    # Shared by every operation that asks: a stolen session gets this many in all.
    password_confirmation_failures: int = Field(default=5, gt=0)
    data_exports_per_account: int = Field(default=3, gt=0)
    # Per address, whatever their outcome.
    registrations_per_ip: int = Field(default=5, gt=0)
    # For /auth/forgot-password and /auth/resend-verification, each.
    email_requests_per_ip: int = Field(default=5, gt=0)
    # For /auth/verify-email and /auth/reset-password, each.
    token_redemptions_per_ip: int = Field(default=10, gt=0)
    # Repeats in this period are ignored, so asking again can't kill the inbox link.
    email_token_cooldown_seconds: int = Field(default=300, ge=0)

    # Engineering defaults for the operator; no law asks for these periods.
    expired_story_retention_hours: int = Field(default=24, ge=0)
    ended_session_retention_days: int = Field(default=30, ge=0)
    spent_token_retention_days: int = Field(default=7, ge=0)
    rate_limit_retention_hours: int = Field(default=1, ge=0)
    # Off by default: where email isn't delivered, this would remove every registration.
    purge_unverified_accounts: bool = False
    # Never zero: registering must leave time to open the link.
    unverified_account_retention_days: int = Field(default=7, gt=0)
    purge_batch_size: int = Field(default=1000, gt=0, le=10000)

    # At least an hour, so the purge can't take the file of an upload still under way.
    orphaned_image_retention_hours: int = Field(default=1, ge=1)

    max_request_body_bytes: int = Field(default=64 * 1024, gt=0)

    # Relative to the start directory; the retention purge must be given the same.
    image_storage_path: str = "media"
    max_image_upload_bytes: int = Field(default=10 * 1024 * 1024, gt=0)
    # Avatars and stories together: decoding is the costliest work a request can ask.
    image_uploads_per_account: int = Field(default=20, gt=0)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # Errors name a refused setting only: values hold the database URL and secret.
        hide_input_in_errors=True,
    )

    @field_validator("frontend_url")
    @classmethod
    def _validate_frontend_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError("must be an absolute http(s) URL")
        return value.rstrip("/")

    @field_validator("resend_api_key", "email_from", mode="before")
    @classmethod
    def _blank_is_not_set(cls, value: object) -> object:
        # An empty line in .env sets nothing.
        text = value.get_secret_value() if isinstance(value, SecretStr) else value
        if isinstance(text, str) and not text.strip():
            return None
        return value

    @field_validator("email_from")
    @classmethod
    def _validate_email_from(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if "@" not in parseaddr(value)[1]:
            raise ValueError(
                'must be an address, or a name and an address: "Name <address>"'
            )
        return value.strip()

    @model_validator(mode="after")
    def _require_safe_settings(self) -> "Settings":
        """Refuses conflicting limits or an unsafe production; fills dev defaults."""
        pair, account = (
            self.login_failures_per_identifier_and_ip,
            self.login_failures_per_identifier,
        )
        if account < _ACCOUNT_TO_ADDRESS_LIMIT_RATIO * pair:
            raise ValueError(
                "LOGIN_FAILURES_PER_IDENTIFIER must be at least "
                f"{_ACCOUNT_TO_ADDRESS_LIMIT_RATIO} times "
                "LOGIN_FAILURES_PER_IDENTIFIER_AND_IP"
            )

        if self.is_development:
            if self.frontend_url is None:
                self.frontend_url = _DEVELOPMENT_FRONTEND_URL
            if self.rate_limit_secret is None:
                self.rate_limit_secret = SecretStr(_DEVELOPMENT_RATE_LIMIT_SECRET)
            return self

        if self.frontend_url is None:
            raise ValueError("FRONTEND_URL must be set in production")
        if urlsplit(self.frontend_url).scheme != "https":
            raise ValueError("FRONTEND_URL must be an https URL in production")
        secret = self.rate_limit_secret
        if secret is None:
            raise ValueError("RATE_LIMIT_SECRET must be set in production")
        if len(secret.get_secret_value()) < _RATE_LIMIT_SECRET_MIN_LENGTH:
            raise ValueError(
                "RATE_LIMIT_SECRET must be at least "
                f"{_RATE_LIMIT_SECRET_MIN_LENGTH} characters long"
            )
        if secret.get_secret_value() == _DEVELOPMENT_RATE_LIMIT_SECRET:
            raise ValueError("RATE_LIMIT_SECRET must not be the development value")
        # Without them, verification and reset links would never arrive.
        if self.resend_api_key is None:
            raise ValueError("RESEND_API_KEY must be set in production")
        if self.email_from is None:
            raise ValueError("EMAIL_FROM must be set in production")
        return self

    @property
    def is_development(self) -> bool:
        return self.environment == "development"

    @property
    def frontend_origin(self) -> str:
        """scheme://host[:port], the form browsers send."""
        parts = urlsplit(self.frontend_url)
        return f"{parts.scheme}://{parts.netloc}".lower()

    @property
    def session_cookie_secure(self) -> bool:
        # Browsers drop Secure cookies over plain HTTP, which local development uses.
        return not self.is_development

    @property
    def session_cookie(self) -> str:
        """``__Host-`` outside development: no sibling subdomain can plant a cookie."""
        if self.session_cookie_secure:
            return f"__Host-{self.session_cookie_name}"
        return self.session_cookie_name

    @property
    def api_docs_enabled(self) -> bool:
        # They describe every route, so only development serves them.
        return self.is_development

    @property
    def rate_limit_window(self) -> timedelta:
        return timedelta(minutes=self.rate_limit_window_minutes)

    @property
    def email_token_cooldown(self) -> timedelta:
        return timedelta(seconds=self.email_token_cooldown_seconds)

    @property
    def expired_story_retention(self) -> timedelta:
        return timedelta(hours=self.expired_story_retention_hours)

    @property
    def ended_session_retention(self) -> timedelta:
        return timedelta(days=self.ended_session_retention_days)

    @property
    def spent_token_retention(self) -> timedelta:
        return timedelta(days=self.spent_token_retention_days)

    @property
    def rate_limit_retention(self) -> timedelta:
        return timedelta(hours=self.rate_limit_retention_hours)

    @property
    def orphaned_image_retention(self) -> timedelta:
        return timedelta(hours=self.orphaned_image_retention_hours)

    @property
    def unverified_account_retention(self) -> timedelta:
        return timedelta(days=self.unverified_account_retention_days)

    @property
    def session_lifetime(self) -> timedelta:
        return timedelta(days=self.session_lifetime_days)

    @property
    def session_last_used_interval(self) -> timedelta:
        return timedelta(seconds=self.session_last_used_interval_seconds)

    @property
    def email_verification_token_lifetime(self) -> timedelta:
        return timedelta(hours=self.email_verification_token_lifetime_hours)

    @property
    def password_reset_token_lifetime(self) -> timedelta:
        return timedelta(minutes=self.password_reset_token_lifetime_minutes)


settings = Settings()
