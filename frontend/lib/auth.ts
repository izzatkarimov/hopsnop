import { ApiError, apiRequest, isApiError } from "./api";
import type { ApiErrorKind } from "./api";
import type { TwoFactorSetup, User } from "./types";

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

/** Password right and two-factor login on: no session yet. */
export type LoginChallengeResponse = {
  challenge: string;
  expires_at: string;
};

export type TwoFactorStartResponse = {
  secret: string;
  otpauth_uri: string;
};

export type RecoveryCodesResponse = {
  recovery_codes: string[];
};

export type TwoFactorPasswordRequest = {
  password: string;
};

export type TwoFactorCodeRequest = {
  password: string;
  code: string;
};

export type TwoFactorLoginRequest = {
  challenge: string;
  code: string;
};

/* The backend reports text only; keep in step with app/services/auth.py. */
const EMAIL_NOT_VERIFIED = "Email address is not verified.";
const USERNAME_TAKEN = "Username already in use.";
const CURRENT_PASSWORD_WRONG = "Current password is incorrect.";
const INVALID_CODE = "Invalid code.";
const INVALID_LOGIN_CHALLENGE = "Invalid or expired login challenge.";
const TWO_FACTOR_ALREADY_ON = "Two-factor login is already on.";
const TWO_FACTOR_OFF = "Two-factor login is off.";
const NO_PENDING_TWO_FACTOR = "No two-factor setup is pending.";

/** A right password gets one of two answers. */
export type LoginResult =
  | { status: "signed_in"; user: User }
  | { status: "two_factor"; challenge: string };

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

/** No session, and the same answer whether or not the address has an account. */
export async function register(data: RegisterRequest): Promise<void> {
  await apiRequest<MessageResponse>("/auth/register", {
    method: "POST",
    body: data,
  });
}

/** 200 and 202 are told apart by the body: only the 202 carries a challenge. */
export async function logIn(data: LoginRequest): Promise<LoginResult> {
  const response = await apiRequest<AccountResponse | LoginChallengeResponse>(
    "/auth/login",
    { method: "POST", body: data },
  );
  if (typeof response === "object" && response !== null && "challenge" in response) {
    const { challenge } = response;
    if (typeof challenge !== "string" || challenge === "") {
      throw new ApiError("server", null, "The server sent an unexpected answer.");
    }
    return { status: "two_factor", challenge };
  }
  return { status: "signed_in", user: toUser(response) };
}

/** Only now does the backend start the session and set the cookie. */
export async function logInWithCode(challenge: string, code: string): Promise<User> {
  const account = await apiRequest<AccountResponse>("/auth/login/two-factor", {
    method: "POST",
    body: { challenge, code } satisfies TwoFactorLoginRequest,
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

/** Not on until confirmed with a code; starting again replaces the secret. */
export async function startTwoFactor(password: string): Promise<TwoFactorSetup> {
  const response = await apiRequest<TwoFactorStartResponse>("/auth/two-factor/start", {
    method: "POST",
    body: { password } satisfies TwoFactorPasswordRequest,
  });
  const secret = response?.secret;
  const otpauthUri = response?.otpauth_uri;
  if (
    typeof secret !== "string" ||
    secret === "" ||
    typeof otpauthUri !== "string" ||
    !otpauthUri.startsWith("otpauth://totp/")
  ) {
    throw new ApiError("server", null, "The server sent an unexpected answer.");
  }
  return { secret, otpauthUri };
}

/** Turns it on; the codes are shown this once. The backend ends other sessions. */
export async function confirmTwoFactor(password: string, code: string): Promise<string[]> {
  return toRecoveryCodes(
    await apiRequest<RecoveryCodesResponse>("/auth/two-factor/confirm", {
      method: "POST",
      body: { password, code } satisfies TwoFactorCodeRequest,
    }),
  );
}

/** The old codes stop working. The backend ends other sessions. */
export async function replaceRecoveryCodes(
  password: string,
  code: string,
): Promise<string[]> {
  return toRecoveryCodes(
    await apiRequest<RecoveryCodesResponse>("/auth/two-factor/recovery-codes", {
      method: "POST",
      body: { password, code } satisfies TwoFactorCodeRequest,
    }),
  );
}

/** Takes an app code or a recovery code. The backend ends other sessions. */
export async function disableTwoFactor(password: string, code: string): Promise<void> {
  await apiRequest<MessageResponse>("/auth/two-factor/disable", {
    method: "POST",
    body: { password, code } satisfies TwoFactorCodeRequest,
  });
}

function toRecoveryCodes(response: RecoveryCodesResponse): string[] {
  const codes: unknown = response?.recovery_codes;
  if (
    !Array.isArray(codes) ||
    codes.length === 0 ||
    !codes.every((code) => typeof code === "string" && code !== "")
  ) {
    throw new ApiError("server", null, "The server sent an unexpected answer.");
  }
  return codes;
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

export function isUsernameTakenError(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.kind === "conflict" &&
    error.message === USERNAME_TAKEN
  );
}

function isRefusal(error: unknown, kind: ApiErrorKind, message: string): boolean {
  return isApiError(error) && error.kind === kind && error.message === message;
}

/** Also a code already used, or a wrong recovery code. */
export function isInvalidCodeError(error: unknown): boolean {
  return isRefusal(error, "bad_request", INVALID_CODE);
}

/** Expired, voided by wrong codes, or replaced by a newer login. */
export function isInvalidLoginChallengeError(error: unknown): boolean {
  return isRefusal(error, "bad_request", INVALID_LOGIN_CHALLENGE);
}

export function isTwoFactorAlreadyOnError(error: unknown): boolean {
  return isRefusal(error, "conflict", TWO_FACTOR_ALREADY_ON);
}

export function isTwoFactorOffError(error: unknown): boolean {
  return isRefusal(error, "bad_request", TWO_FACTOR_OFF);
}

/** The pending secret lasted an hour, or was never started. */
export function isNoPendingTwoFactorError(error: unknown): boolean {
  return isRefusal(error, "bad_request", NO_PENDING_TWO_FACTOR);
}
