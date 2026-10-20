import { ApiError, apiRequest, isApiError } from "./api";
import type { User } from "./types";

/*
 * Authentication endpoints of the Hopsnop API.
 *
 * The types below mirror the backend's request and response schemas, so they
 * use its snake_case field names. Nothing here stores anything: whether the
 * browser is signed in is decided by the session cookie, which only the
 * browser and the backend handle.
 */

/**
 * The account as its owner sees it. Returned by /auth/register, /auth/login
 * and /auth/me, which all share this one schema. Timestamps are ISO 8601.
 */
export type AccountResponse = {
  id: string;
  username: string;
  email: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  is_active: boolean;
  email_verified_at: string | null;
  created_at: string;
};

/**
 * Returned by /auth/verify-email, /auth/resend-verification,
 * /auth/forgot-password, /auth/reset-password and /auth/change-password.
 */
export type MessageResponse = {
  message: string;
};

export type RegisterRequest = {
  username: string;
  email: string;
  password: string;
  display_name: string;
};

export type LoginRequest = {
  /** A username or an email address. */
  identifier: string;
  password: string;
};

export type ChangePasswordRequest = {
  current_password: string;
  new_password: string;
};

export type DeleteAccountRequest = {
  password: string;
};

/*
 * The backend reports errors as text only, without error codes. Where a
 * status code alone is ambiguous, these are the texts that tell cases apart.
 * They must be kept in step with the backend (app/services/auth.py).
 */
const EMAIL_NOT_VERIFIED = "Email address is not verified.";
const USERNAME_TAKEN = "Username already in use.";
const EMAIL_TAKEN = "Email already in use.";
const CURRENT_PASSWORD_WRONG = "Current password is incorrect.";

/**
 * Reduces an account response to what the UI needs in order to show who is
 * signed in. The other fields, such as the email address, are deliberately
 * not carried into application state.
 */
function toUser(account: AccountResponse): User {
  const {
    id,
    username,
    display_name: displayName,
    avatar_url: avatarUrl,
  } = account;
  if (
    typeof id !== "string" ||
    typeof username !== "string" ||
    typeof displayName !== "string" ||
    (typeof avatarUrl !== "string" && avatarUrl !== null)
  ) {
    throw new ApiError("server", null, "The server sent an unexpected account.");
  }
  return { id, username, displayName, avatarUrl };
}

/** The signed-in user, or null if the browser has no valid session. */
export async function getCurrentUser(): Promise<User | null> {
  try {
    return toUser(await apiRequest<AccountResponse>("/auth/me"));
  } catch (error) {
    if (isApiError(error) && error.kind === "unauthenticated") return null;
    throw error;
  }
}

/**
 * Creates an account. The backend does not start a session here: the email
 * address has to be verified before the account can log in.
 */
export async function register(data: RegisterRequest): Promise<void> {
  await apiRequest<AccountResponse>("/auth/register", {
    method: "POST",
    body: data,
  });
}

/** Starts a session. The backend sets the session cookie on the response. */
export async function logIn(data: LoginRequest): Promise<User> {
  const account = await apiRequest<AccountResponse>("/auth/login", {
    method: "POST",
    body: data,
  });
  return toUser(account);
}

/** Ends the session server-side; the backend also clears the cookie. */
export async function logOut(): Promise<void> {
  await apiRequest<void>("/auth/logout", { method: "POST" });
}

/** Redeems the single-use token from a verification link. */
export async function verifyEmail(token: string): Promise<void> {
  await apiRequest<MessageResponse>("/auth/verify-email", {
    method: "POST",
    body: { token },
  });
}

/**
 * Asks for a new verification link. The backend answers the same way whether
 * or not the address belongs to an account, so success says nothing about it.
 */
export async function resendVerification(email: string): Promise<void> {
  await apiRequest<MessageResponse>("/auth/resend-verification", {
    method: "POST",
    body: { email },
  });
}

/**
 * Asks for a password reset link. As with resendVerification(), the backend
 * answers the same way whether or not the address belongs to an account, so
 * success says nothing about it.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiRequest<MessageResponse>("/auth/forgot-password", {
    method: "POST",
    body: { email },
  });
}

/**
 * Redeems the single-use token from a reset link and sets the new password.
 * The backend also ends every session of the account, on every device, and
 * does not start a new one: the user logs in again with the new password.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  await apiRequest<MessageResponse>("/auth/reset-password", {
    method: "POST",
    body: { token, new_password: newPassword },
  });
}

/**
 * Sets a new password for the signed-in user, who must give the current one.
 * Both are sent exactly as typed.
 *
 * The backend ends every other session of the account. This one continues:
 * the response sets a new cookie for it, so nothing changes for the signed-in
 * state here.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiRequest<MessageResponse>("/auth/change-password", {
    method: "POST",
    body: {
      current_password: currentPassword,
      new_password: newPassword,
    } satisfies ChangePasswordRequest,
  });
}

/**
 * Deletes the signed-in user's account, at once and for good, together with
 * everything that is its own. The password has to be given again, exactly
 * as typed.
 *
 * The backend removes every session of the account and clears this
 * browser's session cookie itself. Nothing is kept from which the account
 * could be restored.
 */
export async function deleteAccount(password: string): Promise<void> {
  await apiRequest<void>("/auth/delete-account", {
    method: "POST",
    body: { password } satisfies DeleteAccountRequest,
  });
}

/**
 * Something that asks for the password again (changing it, exporting the
 * account's data, deleting the account) was refused because the password
 * given was wrong. The backend answers this with 400, not 401: the session
 * is still fine.
 */
export function isWrongCurrentPasswordError(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.kind === "bad_request" &&
    error.message === CURRENT_PASSWORD_WRONG
  );
}

/** Login failed because the account's email address is not verified yet. */
export function isEmailNotVerifiedError(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.kind === "forbidden" &&
    error.message === EMAIL_NOT_VERIFIED
  );
}

/** Which registration field is already used by another account, if known. */
export function takenField(error: unknown): "username" | "email" | null {
  if (!isApiError(error) || error.kind !== "conflict") return null;
  if (error.message === USERNAME_TAKEN) return "username";
  if (error.message === EMAIL_TAKEN) return "email";
  return null;
}
