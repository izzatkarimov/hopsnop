import { describe, expect, it } from "vitest";
import { api, html, json, networkError, noContent } from "@/test/api";
import { account } from "@/test/render";
import { ApiError } from "./api";
import {
  changePassword,
  deleteAccount,
  getCurrentUser,
  isEmailNotVerifiedError,
  isWrongCurrentPasswordError,
  takenField,
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

  it("recognises an unverified email address and taken registration fields", () => {
    expect(isEmailNotVerifiedError(new ApiError("forbidden", 403, "Email address is not verified."))).toBe(true);
    expect(isEmailNotVerifiedError(new ApiError("forbidden", 403, "Cross-origin request rejected."))).toBe(false);
    expect(takenField(new ApiError("conflict", 409, "Username already in use."))).toBe("username");
    expect(takenField(new ApiError("conflict", 409, "Email already in use."))).toBe("email");
    expect(takenField(new ApiError("conflict", 409, "Something else."))).toBeNull();
  });
});
