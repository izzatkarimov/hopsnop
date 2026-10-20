import { ApiError, apiRequest } from "./api";
import type { Session } from "./types";

/*
 * Session management endpoints of the Hopsnop API: the signed-in user's
 * active sessions, and ending them.
 *
 * The response types mirror the backend's schemas (app/schemas/auth.py) and
 * use its snake_case field names. All of these endpoints require a session.
 */

/** One of the user's active sessions. Returned by GET /auth/sessions. */
export type SessionResponse = {
  id: string;
  /** ISO 8601 timestamp. */
  created_at: string;
  /** ISO 8601 timestamp. */
  last_used_at: string;
  /** ISO 8601 timestamp. */
  expires_at: string;
  /** Whether this is the session the request was made with. */
  is_current: boolean;
};

/** Returned by POST /auth/sessions/revoke-others. */
export type RevokedSessionsResponse = {
  /** How many sessions were ended. */
  revoked_count: number;
};

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function toSession(response: SessionResponse): Session {
  const {
    id,
    created_at: createdAt,
    last_used_at: lastUsedAt,
    expires_at: expiresAt,
    is_current: isCurrent,
  }: Partial<SessionResponse> = response ?? {};

  if (
    typeof id !== "string" ||
    !isTimestamp(createdAt) ||
    !isTimestamp(lastUsedAt) ||
    !isTimestamp(expiresAt) ||
    typeof isCurrent !== "boolean"
  ) {
    throw new ApiError("server", null, "The server sent an unexpected session.");
  }
  return { id, createdAt, lastUsedAt, expiresAt, isCurrent };
}

/**
 * The signed-in user's sessions that are still usable, most recently used
 * first. Ended and expired sessions are not included.
 */
export async function listSessions(): Promise<Session[]> {
  const response = await apiRequest<SessionResponse[]>("/auth/sessions");
  if (!Array.isArray(response)) {
    throw new ApiError("server", null, "The server sent an unexpected answer.");
  }
  return response.map(toSession);
}

/**
 * Ends one of the signed-in user's sessions. Ending the current one also
 * clears the session cookie: the browser is then signed out.
 *
 * The ApiError is "not_found" if there is no such active session, e.g.
 * because it has already ended.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await apiRequest<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

/**
 * Ends every session of the signed-in user except the current one, and
 * returns how many were ended.
 */
export async function revokeOtherSessions(): Promise<number> {
  const response = await apiRequest<RevokedSessionsResponse>(
    "/auth/sessions/revoke-others",
    { method: "POST" },
  );
  const count = response?.revoked_count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw new ApiError("server", null, "The server sent an unexpected answer.");
  }
  return count;
}
