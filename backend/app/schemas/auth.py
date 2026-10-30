import re
import unicodedata
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    SecretStr,
    StringConstraints,
)

from app.core.config import settings
from app.core.security import PASSWORD_MAX_LENGTH

# ASCII only: lowercasing gives one canonical form, and no two usernames look alike.
_USERNAME_PATTERN = re.compile(r"[A-Za-z0-9_]{3,30}")


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


def _normalize_username(value: str) -> str:
    if not _USERNAME_PATTERN.fullmatch(value):
        raise ValueError(
            "Username must be 3 to 30 characters long and contain only "
            "letters, digits and underscores."
        )
    return value.lower()


def _normalize_email(value: str) -> str:
    # Stored lowercased and unique, which is only well defined for ASCII.
    if not value.isascii():
        raise ValueError("Email address must contain only ASCII characters.")
    return value.lower()


def reject_nul(value: str) -> str:
    # PostgreSQL can't store this character in text, nor compare with it.
    if "\x00" in value:
        raise ValueError("Must not contain null characters.")
    return value


# Needed by some scripts and emoji: allowed only between non-ASCII, non-spaces.
_JOINERS = frozenset("\u200c\u200d")
# Drawn as nothing whatever their category: Hangul fillers and blank Braille.
_BLANK_CHARACTERS = frozenset("\u115f\u1160\u3164\uffa0\u2800")
# Control, format (zero-width, direction overrides), separators, private, unassigned.
_UNSEEN_CATEGORIES = frozenset({"Cc", "Cf", "Zl", "Zp", "Co", "Cs", "Cn"})
# Letters, numbers, punctuation, symbols; marks and spaces alone may show as nothing.
_VISIBLE_CATEGORIES = frozenset("LNPS")


def _joins(value: str, index: int) -> bool:
    if index == 0 or index == len(value) - 1:
        return False
    return all(
        not neighbour.isascii()
        and not neighbour.isspace()
        and neighbour not in _JOINERS
        for neighbour in (value[index - 1], value[index + 1])
    )


def _check_display_name(value: str) -> str:
    """A name must not look empty or reordered: nothing unseen, not only marks."""
    for index, character in enumerate(value):
        if character in _JOINERS:
            if _joins(value, index):
                continue
        elif (
            unicodedata.category(character) not in _UNSEEN_CATEGORIES
            and character not in _BLANK_CHARACTERS
        ):
            continue
        raise ValueError(
            "Display name must not contain control, invisible or "
            "text-direction characters."
        )
    if not any(
        unicodedata.category(character)[0] in _VISIBLE_CATEGORIES
        for character in value
    ):
        raise ValueError(
            "Display name must contain at least one letter, number, "
            "punctuation mark or symbol."
        )
    return value


def _check_password_length(value: SecretStr) -> SecretStr:
    if len(value.get_secret_value()) < settings.password_min_length:
        raise ValueError(
            f"Password must be at least {settings.password_min_length} "
            "characters long."
        )
    return value


Username = Annotated[str, BeforeValidator(_strip), AfterValidator(_normalize_username)]
Email = Annotated[
    EmailStr,
    BeforeValidator(_strip),
    AfterValidator(_normalize_email),
    Field(max_length=255),
]
DisplayName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
    AfterValidator(_check_display_name),
]
# Length only; taken exactly as typed, never trimmed.
NewPassword = Annotated[
    SecretStr,
    Field(max_length=PASSWORD_MAX_LENGTH),
    AfterValidator(_check_password_length),
]
Token = Annotated[SecretStr, Field(min_length=1, max_length=256)]


class RegisterRequest(BaseModel):
    username: Username
    email: Email
    password: NewPassword
    display_name: DisplayName


class LoginRequest(BaseModel):
    # A username or an email address.
    identifier: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            to_lower=True,
            min_length=1,
            max_length=255,
        ),
        AfterValidator(reject_nul),
    ]
    # Not held to the current policy, which may be stricter than the account's password.
    password: Annotated[SecretStr, Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)]


class VerifyEmailRequest(BaseModel):
    token: Token


class ResendVerificationRequest(BaseModel):
    email: Email


class ForgotPasswordRequest(BaseModel):
    email: Email


class ResetPasswordRequest(BaseModel):
    token: Token
    new_password: NewPassword


class ChangePasswordRequest(BaseModel):
    # Checked against the account, not the policy for choosing one.
    current_password: Annotated[
        SecretStr, Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)
    ]
    new_password: NewPassword


class DeleteAccountRequest(BaseModel):
    """Only the password: the session says which account."""

    # Checked against the account, not the policy for choosing one.
    password: Annotated[SecretStr, Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)]


class AccountResponse(BaseModel):
    """Has private fields such as the email address: only for the account's owner."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    email: str
    display_name: str
    bio: str | None
    avatar_url: str | None
    is_active: bool
    email_verified_at: datetime | None
    created_at: datetime


class SessionResponse(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    is_current: bool


class RevokedSessionsResponse(BaseModel):
    revoked_count: int


class MessageResponse(BaseModel):
    message: str
