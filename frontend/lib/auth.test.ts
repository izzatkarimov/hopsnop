import { describe, expect, it } from "vitest";
import { api, html, json, networkError, noContent } from "@/test/api";
import { LOGIN_CHALLENGE, RECOVERY_CODES, TWO_FACTOR_SETUP } from "@/test/fixtures";
import { account } from "@/test/render";
import { ApiError } from "./api";
import {
  changePassword,
  confirmTwoFactor,
  deleteAccount,
  disableTwoFactor,
  getCurrentUser,
  isEmailNotVerifiedError,
  isInvalidCodeError,
  isInvalidLoginChallengeError,
  isNoPendingTwoFactorError,
  isTwoFactorAlreadyOnError,
  isTwoFactorOffError,
  isUsernameTakenError,
  isWrongCurrentPasswordError,
  logIn,
  logInWithCode,
  replaceRecoveryCodes,
  startTwoFactor,
} from "./auth";

describe("getCurrentUser", () => {
  it("keeps only what the UI needs to show who is signed in", async () => {
    api.on("GET", "/auth/me", json(200, account));

    const user = await getCurrentUser();

    expect(user).toEqual({
      id: account.id,
      username: account.username,
      displayName: account.display_name,
      avatarUrl: null,
    });
  });

  it("is null, not an error, when the backend says there is no session", async () => {
    api.on("GET", "/auth/me", json(401, { detail: "Not authenticated." }));

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it.each([
    ["the API is unreachable", networkError(), "network"],
    ["the server fails", json(503, { detail: "Unavailable." }), "server"],
    ["a 401 comes from something other than the backend", html(401), "server"],
  ])("fails, rather than saying 'signed out', when %s", async (_, reply, kind) => {
    api.on("GET", "/auth/me", reply);

    await expect(getCurrentUser()).rejects.toMatchObject({ kind });
  });

  it("refuses an account of the wrong shape", async () => {
    api.on("GET", "/auth/me", json(200, { ...account, username: 42 }));

    await expect(getCurrentUser()).rejects.toMatchObject({
      kind: "server",
      message: "The server sent an unexpected account.",
    });
  });
});

describe("requests that confirm the password", () => {
  it("changePassword sends both passwords exactly as typed", async () => {
    api.on("POST", "/auth/change-password", json(200, { message: "Password has been changed." }));

    await changePassword(" old password ", "new password 1");

    expect(api.calls("POST", "/auth/change-password")[0].body).toEqual({
      current_password: " old password ",
      new_password: "new password 1",
    });
  });

  it("deleteAccount sends the password and nothing else", async () => {
    api.on("POST", "/auth/delete-account", noContent());

    await deleteAccount("my password");

    expect(api.calls("POST", "/auth/delete-account")[0].body).toEqual({ password: "my password" });
  });
});

describe("telling the backend's refusals apart", () => {
  it("recognises a wrong current password by the backend's 400 and its text", () => {
    expect(
      isWrongCurrentPasswordError(new ApiError("bad_request", 400, "Current password is incorrect.")),
    ).toBe(true);
    expect(
      isWrongCurrentPasswordError(new ApiError("unauthenticated", 401, "Current password is incorrect.")),
    ).toBe(false);
    expect(isWrongCurrentPasswordError(new ApiError("bad_request", 400, "Something else."))).toBe(false);
    expect(isWrongCurrentPasswordError(new Error("Current password is incorrect."))).toBe(false);
  });

  it("recognises an unverified email address and a taken username", () => {
    expect(isEmailNotVerifiedError(new ApiError("forbidden", 403, "Email address is not verified."))).toBe(true);
    expect(isEmailNotVerifiedError(new ApiError("forbidden", 403, "Cross-origin request rejected."))).toBe(false);
    expect(isUsernameTakenError(new ApiError("conflict", 409, "Username already in use."))).toBe(true);
    expect(isUsernameTakenError(new ApiError("conflict", 409, "Something else."))).toBe(false);
    expect(isUsernameTakenError(new ApiError("bad_request", 400, "Username already in use."))).toBe(false);
  });
});

describe("logIn", () => {
  const credentials = { identifier: "test_viewer", password: "a password" };

  it("is signed in when the backend answers with the account", async () => {
    api.on("POST", "/auth/login", json(200, account));

    await expect(logIn(credentials)).resolves.toEqual({
      status: "signed_in",
      user: { id: account.id, username: account.username, displayName: account.display_name, avatarUrl: null },
    });
  });

  it("hands back the challenge, and nothing else, when a code is needed", async () => {
    api.on("POST", "/auth/login", json(202, LOGIN_CHALLENGE));

    await expect(logIn(credentials)).resolves.toEqual({
      status: "two_factor",
      challenge: LOGIN_CHALLENGE.challenge,
    });
  });

  it.each([
    ["no challenge", { challenge: "", expires_at: LOGIN_CHALLENGE.expires_at }],
    ["a challenge that isn't text", { challenge: 42, expires_at: LOGIN_CHALLENGE.expires_at }],
  ])("refuses an answer with %s", async (_, body) => {
    api.on("POST", "/auth/login", json(202, body));

    await expect(logIn(credentials)).rejects.toMatchObject({ kind: "server" });
  });

  it("logInWithCode sends the challenge and the code as typed, and returns who is signed in", async () => {
    api.on("POST", "/auth/login/two-factor", json(200, account));

    const user = await logInWithCode(LOGIN_CHALLENGE.challenge, " 123 456 ");

    expect(user.username).toBe(account.username);
    expect(api.calls("POST", "/auth/login/two-factor")[0].body).toEqual({
      challenge: LOGIN_CHALLENGE.challenge,
      code: " 123 456 ",
    });
  });
});

describe("two-factor settings requests", () => {
  it("startTwoFactor sends the password and returns the secret and the URI", async () => {
    api.on("POST", "/auth/two-factor/start", json(200, TWO_FACTOR_SETUP));

    await expect(startTwoFactor("my password")).resolves.toEqual({
      secret: TWO_FACTOR_SETUP.secret,
      otpauthUri: TWO_FACTOR_SETUP.otpauth_uri,
    });
    expect(api.calls("POST", "/auth/two-factor/start")[0].body).toEqual({ password: "my password" });
  });

  it.each([
    ["an address that isn't an otpauth TOTP URI", { ...TWO_FACTOR_SETUP, otpauth_uri: "https://example.com/" }],
    ["no secret", { ...TWO_FACTOR_SETUP, secret: "" }],
  ])("startTwoFactor refuses %s", async (_, body) => {
    api.on("POST", "/auth/two-factor/start", json(200, body));

    await expect(startTwoFactor("my password")).rejects.toMatchObject({ kind: "server" });
  });

  it("confirmTwoFactor and replaceRecoveryCodes send the password and code, and return the codes", async () => {
    api.on("POST", "/auth/two-factor/confirm", json(200, { recovery_codes: RECOVERY_CODES }));
    api.on("POST", "/auth/two-factor/recovery-codes", json(200, { recovery_codes: RECOVERY_CODES }));

    await expect(confirmTwoFactor("my password", "123456")).resolves.toEqual(RECOVERY_CODES);
    await expect(replaceRecoveryCodes("my password", "654321")).resolves.toEqual(RECOVERY_CODES);
    expect(api.calls("POST", "/auth/two-factor/confirm")[0].body).toEqual({ password: "my password", code: "123456" });
    expect(api.calls("POST", "/auth/two-factor/recovery-codes")[0].body).toEqual({
      password: "my password",
      code: "654321",
    });
  });

  it.each([
    ["no codes", { recovery_codes: [] }],
    ["codes that aren't text", { recovery_codes: [1, 2] }],
    ["no list", {}],
  ])("refuses an answer with %s", async (_, body) => {
    api.on("POST", "/auth/two-factor/confirm", json(200, body));

    await expect(confirmTwoFactor("my password", "123456")).rejects.toMatchObject({ kind: "server" });
  });

  it("disableTwoFactor sends the password and the code, a recovery code included", async () => {
    api.on("POST", "/auth/two-factor/disable", json(200, { message: "Two-factor login is off." }));

    await disableTwoFactor("my password", "abcd-efgh-jkmn-pqrs");

    expect(api.calls("POST", "/auth/two-factor/disable")[0].body).toEqual({
      password: "my password",
      code: "abcd-efgh-jkmn-pqrs",
    });
  });
});

describe("telling two-factor refusals apart", () => {
  it("knows each by the backend's status and its text", () => {
    expect(isInvalidCodeError(new ApiError("bad_request", 400, "Invalid code."))).toBe(true);
    expect(isInvalidCodeError(new ApiError("bad_request", 400, "Invalid or expired login challenge."))).toBe(false);
    expect(isInvalidLoginChallengeError(new ApiError("bad_request", 400, "Invalid or expired login challenge."))).toBe(
      true,
    );
    expect(isInvalidLoginChallengeError(new ApiError("bad_request", 400, "Invalid code."))).toBe(false);
    expect(isTwoFactorAlreadyOnError(new ApiError("conflict", 409, "Two-factor login is already on."))).toBe(true);
    expect(isTwoFactorAlreadyOnError(new ApiError("bad_request", 400, "Two-factor login is already on."))).toBe(false);
    expect(isTwoFactorOffError(new ApiError("bad_request", 400, "Two-factor login is off."))).toBe(true);
    expect(isNoPendingTwoFactorError(new ApiError("bad_request", 400, "No two-factor setup is pending."))).toBe(true);
    expect(isInvalidCodeError(new Error("Invalid code."))).toBe(false);
  });
});
