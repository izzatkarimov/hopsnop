"""TOTP per RFC 6238, the secret's encryption and recovery-code hashing; no database."""

import base64
import hashlib
import hmac
import re
import secrets
import struct
import uuid
from datetime import datetime
from urllib.parse import quote, urlencode

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

ISSUER = "Hopsnop"
STEP_SECONDS = 30
DIGITS = 6
# The previous and next step, for clocks that differ.
DRIFT_STEPS = 1

_SECRET_BYTES = 20
_NONCE_BYTES = 12
_TOTP_PATTERN = re.compile(r"[0-9]{6}")

RECOVERY_CODE_COUNT = 10
# Crockford's base32: no I, L, O or U to misread. 16 characters are 80 random bits.
_RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_RECOVERY_CODE_LENGTH = 16
_RECOVERY_GROUP = 4


def hotp(secret: bytes, counter: int, digits: int = DIGITS) -> str:
    digest = hmac.new(secret, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**digits).zfill(digits)


def step_at(when: datetime) -> int:
    return int(when.timestamp()) // STEP_SECONDS


def tidied(code: str) -> str:
    """As apps and people write them: spaces and dashes mean nothing, nor does case."""
    return code.replace(" ", "").replace("-", "").upper()


def is_totp_code(code: str) -> bool:
    return _TOTP_PATTERN.fullmatch(code) is not None


def matching_step(
    secret: bytes, code: str, when: datetime, *, after: int | None
) -> int | None:
    """The newest step within drift that the code fits, if it's later than ``after``."""
    current = step_at(when)
    found = None
    for step in range(current - DRIFT_STEPS, current + DRIFT_STEPS + 1):
        if hmac.compare_digest(hotp(secret, step), code):
            found = step
    if found is None or (after is not None and found <= after):
        return None
    return found


def new_secret() -> bytes:
    return secrets.token_bytes(_SECRET_BYTES)


def base32_secret(secret: bytes) -> str:
    return base64.b32encode(secret).decode("ascii").rstrip("=")


def otpauth_uri(secret: bytes, username: str) -> str:
    query = urlencode(
        {
            "secret": base32_secret(secret),
            "issuer": ISSUER,
            "algorithm": "SHA1",
            "digits": DIGITS,
            "period": STEP_SECONDS,
        }
    )
    return f"otpauth://totp/{quote(ISSUER)}:{quote(username)}?{query}"


def _subkey(purpose: bytes) -> bytes:
    """One setting, and a key of its own for each use."""
    return hmac.new(settings.two_factor_key_bytes, purpose, hashlib.sha256).digest()


def encrypt_secret(secret: bytes, user_id: uuid.UUID) -> bytes:
    """The account is authenticated with it: a value copied to another row won't open."""
    nonce = secrets.token_bytes(_NONCE_BYTES)
    cipher = AESGCM(_subkey(b"hopsnop two-factor secret"))
    return nonce + cipher.encrypt(nonce, secret, user_id.bytes)


def decrypt_secret(stored: bytes, user_id: uuid.UUID) -> bytes:
    nonce, ciphertext = stored[:_NONCE_BYTES], stored[_NONCE_BYTES:]
    cipher = AESGCM(_subkey(b"hopsnop two-factor secret"))
    return cipher.decrypt(nonce, ciphertext, user_id.bytes)


def new_recovery_codes() -> list[str]:
    return [_new_recovery_code() for _ in range(RECOVERY_CODE_COUNT)]


def _new_recovery_code() -> str:
    code = "".join(
        secrets.choice(_RECOVERY_ALPHABET) for _ in range(_RECOVERY_CODE_LENGTH)
    )
    return "-".join(
        code[start : start + _RECOVERY_GROUP]
        for start in range(0, _RECOVERY_CODE_LENGTH, _RECOVERY_GROUP)
    )


def recovery_code_hash(user_id: uuid.UUID, code: str) -> str:
    """Fast is enough: 80 random bits can't be guessed, whatever the hash costs."""
    message = user_id.bytes + tidied(code).encode("utf-8")
    return hmac.new(
        _subkey(b"hopsnop recovery codes"), message, hashlib.sha256
    ).hexdigest()
