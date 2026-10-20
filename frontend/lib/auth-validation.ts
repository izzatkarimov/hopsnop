import { countCharacters } from "./posts";

/*
 * Client-side checks for the registration form.
 *
 * They mirror the backend's rules (app/schemas/auth.py) so that most mistakes
 * are caught before a request is sent. They are a convenience only: the
 * backend validates everything again and its answer is the one that counts.
 *
 * Each function returns an error message, or null if the value is acceptable.
 */

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;
// Deliberately loose: something@something.something, without spaces.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DISPLAY_NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 255;
/** The backend's default; it can be configured to require more. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Whether the text has the shape of a username. Says nothing about existence. */
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

/** The password is checked exactly as typed; it is never trimmed. */
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
