import { describe, expect, it } from "vitest";
import { api, json } from "@/test/api";
import { listSessions, revokeOtherSessions, revokeSession } from "./sessions";

const session = {
  id: "0b6a9d7e-3c1f-4d2a-8e5b-9f0c1d2e3f4a",
  created_at: "2026-10-01T08:00:00.000000Z",
  last_used_at: "2026-10-19T12:00:00.000000Z",
  expires_at: "2026-10-31T08:00:00.000000Z",
  is_current: true,
};

describe("listSessions", () => {
  it("maps the backend's sessions to the app's", async () => {
    api.on("GET", "/auth/sessions", json(200, [session]));

    await expect(listSessions()).resolves.toEqual([
      {
        id: session.id,
        createdAt: session.created_at,
        lastUsedAt: session.last_used_at,
        expiresAt: session.expires_at,
        isCurrent: true,
      },
    ]);
  });

  it.each([
    ["not a list", { items: [] }],
    ["an unreadable date", [{ ...session, expires_at: "soon" }]],
    ["no current flag", [{ ...session, is_current: undefined }]],
    ["an empty entry", [null]],
  ])("refuses an answer with %s", async (_, body) => {
    api.on("GET", "/auth/sessions", json(200, body));

    await expect(listSessions()).rejects.toMatchObject({ kind: "server" });
  });
});

describe("ending sessions", () => {
  it("revokeSession addresses the session by its id", async () => {
    api.on("DELETE", `/auth/sessions/${session.id}`, () => new Response(null, { status: 204 }));

    await revokeSession(session.id);

    expect(api.calls("DELETE")).toHaveLength(1);
  });

  it("revokeOtherSessions returns how many the backend ended", async () => {
    api.on("POST", "/auth/sessions/revoke-others", json(200, { revoked_count: 2 }));

    await expect(revokeOtherSessions()).resolves.toBe(2);
  });

  it.each([-1, 1.5, "2", null])("refuses a count of %j", async (count) => {
    api.on("POST", "/auth/sessions/revoke-others", json(200, { revoked_count: count }));

    await expect(revokeOtherSessions()).rejects.toMatchObject({ kind: "server" });
  });
});
