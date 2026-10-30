import { describe, expect, it, vi } from "vitest";
import { api, html, json, networkError, noContent } from "@/test/api";
import {
  ApiError,
  apiDownload,
  apiRequest,
  isApiError,
  unexpectedErrorMessage,
} from "./api";

async function failure(request: Promise<unknown>): Promise<ApiError> {
  const error = await request.then(
    () => {
      throw new Error("The request was expected to fail.");
    },
    (error: unknown) => error,
  );
  if (!isApiError(error)) throw error;
  return error;
}

describe("apiRequest", () => {
  it("sends the session cookie and a JSON body to the API", async () => {
    api.on("POST", "/posts", json(201, { id: "p1" }));

    await expect(
      apiRequest("/posts", { method: "POST", body: { content: "Hello" } }),
    ).resolves.toEqual({ id: "p1" });

    const [call] = api.calls();
    expect(call.init.credentials).toBe("include");
    expect(call.init.headers).toEqual({ "Content-Type": "application/json" });
    expect(call.body).toEqual({ content: "Hello" });
  });

  it("sends no header at all without a body", async () => {
    api.on("GET", "/feed", json(200, { items: [], next_cursor: null }));

    await apiRequest("/feed");

    expect(api.calls()[0].init).toMatchObject({ method: "GET", headers: undefined, body: undefined });
  });

  it("resolves with nothing for 204 No Content", async () => {
    api.on("POST", "/auth/logout", noContent());

    await expect(apiRequest("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it.each([
    [400, "bad_request"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [418, "bad_request"],
    [422, "validation"],
    [429, "rate_limited"],
    [500, "server"],
    [503, "server"],
  ])("tells a %i answer apart as %s", async (status, kind) => {
    api.on("GET", "/thing", json(status, { detail: "What the backend said." }));

    const error = await failure(apiRequest("/thing"));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind, status, message: "What the backend said." });
  });

  it("keeps a generic message when the error has no text detail", async () => {
    api.on("GET", "/thing", json(500, { unexpected: true }));

    expect(await failure(apiRequest("/thing"))).toMatchObject({
      kind: "server",
      message: "The request failed.",
    });
  });

  it("turns a 422 into one message per field the backend rejected", async () => {
    api.on(
      "POST",
      "/auth/register",
      json(422, {
        detail: [
          { loc: ["body", "username"], msg: "Value error, Username already taken.", type: "value_error" },
          { loc: ["body", "username"], msg: "A second message.", type: "value_error" },
          { loc: ["body", "email"], msg: "Not an email address.", type: "value_error" },
          { loc: ["body"], msg: "About the body as a whole.", type: "value_error" },
          { loc: ["query", "limit"], msg: "Not about the body.", type: "value_error" },
        ],
      }),
    );

    const error = await failure(apiRequest("/auth/register", { method: "POST", body: {} }));

    expect(error.kind).toBe("validation");
    expect(error.fieldErrors).toEqual({
      username: "Username already taken.",
      email: "Not an email address.",
    });
  });

  it("reads Retry-After from a 429, in whole seconds only", async () => {
    api.on("GET", "/a", json(429, { detail: "Slow down." }, { "Retry-After": "120" }));
    api.on("GET", "/b", json(429, { detail: "Slow down." }, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }));
    api.on("GET", "/c", json(429, { detail: "Slow down." }));
    api.on("GET", "/d", json(503, { detail: "Down." }, { "Retry-After": "120" }));

    expect((await failure(apiRequest("/a"))).retryAfter).toBe(120);
    expect((await failure(apiRequest("/b"))).retryAfter).toBeNull();
    expect((await failure(apiRequest("/c"))).retryAfter).toBeNull();
    expect((await failure(apiRequest("/d"))).retryAfter).toBeNull();
  });

  it("does not take a 401 it cannot read for the backend's 'not signed in'", async () => {
    api.on("GET", "/auth/me", html(401));

    expect(await failure(apiRequest("/auth/me"))).toMatchObject({
      kind: "server",
      status: 401,
      message: "The server sent an unreadable response.",
    });
  });

  it("treats a success it cannot read as a server error", async () => {
    api.on("GET", "/users/me", html(200));

    expect(await failure(apiRequest("/users/me"))).toMatchObject({ kind: "server", status: 200 });
  });

  it("treats no response at all as a network error", async () => {
    api.on("GET", "/feed", networkError());

    expect(await failure(apiRequest("/feed"))).toMatchObject({
      kind: "network",
      status: null,
      message: "The server could not be reached.",
    });
  });

  it("refuses to send anything when the API URL is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.resetModules();
    const { apiRequest: unconfigured } = await import("./api");

    await expect(unconfigured("/auth/me")).rejects.toThrow("NEXT_PUBLIC_API_URL is not set");
    expect(api.calls()).toEqual([]);
  });
});

describe("apiDownload", () => {
  it("returns the body exactly as sent, and the file name the response gives", async () => {
    const body = '{"export_version":1,"note":"café"}';
    api.on("POST", "/users/me/export", () =>
      new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="hopsnop-export-alice-2026-10-19.json"',
        },
      }),
    );

    const file = await apiDownload("/users/me/export", { method: "POST", body: { password: "x" } });

    expect(await file.blob.text()).toBe(body);
    expect(file.filename).toBe("hopsnop-export-alice-2026-10-19.json");
  });

  it.each([
    ["no header", undefined, null],
    ["a name that tries to leave the folder", 'attachment; filename="../../etc/passwd"', ".._.._etc_passwd"],
    ["an unquoted name", "attachment; filename=report.json", "report.json"],
    ["a name of dots only", 'attachment; filename=".."', null],
  ])("handles %s", async (_, disposition, filename) => {
    api.on("GET", "/file", () =>
      new Response("{}", {
        status: 200,
        headers: disposition ? { "Content-Disposition": disposition } : {},
      }),
    );

    expect((await apiDownload("/file")).filename).toBe(filename);
  });

  it("fails like apiRequest for an error answer", async () => {
    api.on("POST", "/users/me/export", json(401, { detail: "Not authenticated." }));

    expect(await failure(apiDownload("/users/me/export", { method: "POST" }))).toMatchObject({
      kind: "unauthenticated",
    });
  });
});

describe("unexpectedErrorMessage", () => {
  it.each([
    [new ApiError("network", null, "x"), "Couldn't reach Hopsnop. Check your connection and try again."],
    [new ApiError("server", 500, "x"), "Something went wrong. Please try again."],
    [new Error("not an ApiError"), "Something went wrong. Please try again."],
    [new ApiError("rate_limited", 429, "x"), "Too many attempts. Please wait a while before trying again."],
    [new ApiError("rate_limited", 429, "x", {}, 0), "Too many attempts. Please wait 1 second before trying again."],
    [new ApiError("rate_limited", 429, "x", {}, 45), "Too many attempts. Please wait 45 seconds before trying again."],
    [new ApiError("rate_limited", 429, "x", {}, 60), "Too many attempts. Please wait about 1 minute before trying again."],
    [new ApiError("rate_limited", 429, "x", {}, 61), "Too many attempts. Please wait about 2 minutes before trying again."],
  ])("explains %o", (error, message) => {
    expect(unexpectedErrorMessage(error)).toBe(message);
  });
});
