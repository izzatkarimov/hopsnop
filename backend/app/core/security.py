"""Argon2id for low-entropy passwords; SHA-256 for random tokens, looked up by hash."""

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

# Library defaults: Argon2id, RFC 9106 low-memory; salt and parameters are in the hash.
_password_hasher = PasswordHasher()

# Bounds what a request can make the server hash.
PASSWORD_MAX_LENGTH = 128

_TOKEN_BYTES = 32


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        # Wrong password, or a stored value that isn't an Argon2 hash.
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _password_hasher.check_needs_rehash(password_hash)


# Checked when the account doesn't exist, so timing doesn't reveal which accounts do.
DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(_TOKEN_BYTES))


def generate_token() -> str:
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
