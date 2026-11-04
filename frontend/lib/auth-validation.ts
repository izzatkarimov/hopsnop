import { countCharacters } from "./posts";

/* A convenience mirroring app/schemas/auth.py; the backend's answer counts. */

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;
// Deliberately loose: something@something.something, no spaces.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DISPLAY_NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 255;
/** The backend's default; it can be configured to require more. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function isUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

export function validateDisplayName(value: string): string | null {
  const name = value.trim();
  if (name === "") return "Enter a display name.";
  if (countCharacters(name) > DISPLAY_NAME_MAX_LENGTH) {
    return `Use at most ${DISPLAY_NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

export function validateUsername(value: string): string | null {
  const username = value.trim();
  if (username === "") return "Choose a username.";
  if (!USERNAME_PATTERN.test(username)) {
    return "Use 3 to 30 letters, numbers or underscores.";
  }
  return null;
}

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (email === "") return "Enter your email address.";
  if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX_LENGTH) {
    return "Enter a valid email address.";
  }
  return null;
}

/** The backend's limit on a code as sent, spaces and dashes included. */
export const TWO_FACTOR_CODE_MAX_LENGTH = 32;
const APP_CODE_PATTERN = /^[0-9]{6}$/;
// Shape only: the backend alone knows which letters its codes use.
const RECOVERY_CODE_PATTERN = /^[0-9A-Z]{16}$/;

/** As tidied() in app/core/two_factor.py tidies it. */
function tidyCode(value: string): string {
  return value.replace(/[ -]/g, "").toUpperCase();
}

/** A malformed code would still count as a wrong one, so it isn't sent. */
export function validateAppCode(value: string): string | null {
  const code = tidyCode(value);
  if (code === "") return "Enter the code from your authenticator app.";
  if (!APP_CODE_PATTERN.test(code) || value.length > TWO_FACTOR_CODE_MAX_LENGTH) {
    return "Enter the 6 digits your authenticator app shows.";
  }
  return null;
}

export function validateAppOrRecoveryCode(value: string): string | null {
  const code = tidyCode(value);
  if (code === "") return "Enter a code from your authenticator app or a recovery code.";
  if (
    !(APP_CODE_PATTERN.test(code) || RECOVERY_CODE_PATTERN.test(code)) ||
    value.length > TWO_FACTOR_CODE_MAX_LENGTH
  ) {
    return "Enter the 6 digits from your app, or a recovery code like ABCD-EFGH-JKMN-PQRS.";
  }
  return null;
}

/** Checked exactly as typed; never trimmed. */
export function validateNewPassword(value: string): string | null {
  const length = countCharacters(value);
  if (length === 0) return "Choose a password.";
  if (length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}
