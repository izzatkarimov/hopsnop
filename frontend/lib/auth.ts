import { ApiError, apiRequest, isApiError } from "./api";
import type { User } from "./types";

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

/* The backend reports text only; keep in step with app/services/auth.py. */
const EMAIL_NOT_VERIFIED = "Email address is not verified.";
const USERNAME_TAKEN = "Username already in use.";
const EMAIL_TAKEN = "Email already in use.";
const CURRENT_PASSWORD_WRONG = "Current password is incorrect.";

/** Private fields such as the email address are deliberately not kept in app state. */
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

export async function getCurrentUser(): Promise<User | null> {
  try {
    return toUser(await apiRequest<AccountResponse>("/auth/me"));
  } catch (error) {
    if (isApiError(error) && error.kind === "unauthenticated") return null;
    throw error;
  }
}

/** No session here: the address has to be verified first. */
export async function register(data: RegisterRequest): Promise<void> {
  await apiRequest<AccountResponse>("/auth/register", {
    method: "POST",
    body: data,
  });
}

export async function logIn(data: LoginRequest): Promise<User> {
  const account = await apiRequest<AccountResponse>("/auth/login", {
    method: "POST",
    body: data,
  });
  return toUser(account);
}

export async function logOut(): Promise<void> {
  await apiRequest<void>("/auth/logout", { method: "POST" });
}

export async function verifyEmail(token: string): Promise<void> {
  await apiRequest<MessageResponse>("/auth/verify-email", {
    method: "POST",
    body: { token },
  });
}

/** The same answer whether or not the address has an account. */
export async function resendVerification(email: string): Promise<void> {
  await apiRequest<MessageResponse>("/auth/resend-verification", {
    method: "POST",
    body: { email },
  });
}

/** The same answer whether or not the address has an account. */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiRequest<MessageResponse>("/auth/forgot-password", {
    method: "POST",
    body: { email },
  });
}

/** The backend also ends every session and starts none: the user logs in again. */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  await apiRequest<MessageResponse>("/auth/reset-password", {
    method: "POST",
    body: { token, new_password: newPassword },
  });
}

/** Sent as typed. Other sessions end; this one continues under a new cookie. */
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

/** The backend removes every session and clears this browser's cookie itself. */
export async function deleteAccount(password: string): Promise<void> {
  await apiRequest<void>("/auth/delete-account", {
    method: "POST",
    body: { password } satisfies DeleteAccountRequest,
  });
}

/** 400, not 401: the session is still fine. */
export function isWrongCurrentPasswordError(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.kind === "bad_request" &&
    error.message === CURRENT_PASSWORD_WRONG
  );
}

export function isEmailNotVerifiedError(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.kind === "forbidden" &&
    error.message === EMAIL_NOT_VERIFIED
  );
}

export function takenField(error: unknown): "username" | "email" | null {
  if (!isApiError(error) || error.kind !== "conflict") return null;
  if (error.message === USERNAME_TAKEN) return "username";
  if (error.message === EMAIL_TAKEN) return "email";
  return null;
}
