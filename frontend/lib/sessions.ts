import { ApiError, apiRequest } from "./api";
import type { Session } from "./types";

export type SessionResponse = {
  id: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  is_current: boolean;
};

export type RevokedSessionsResponse = {
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

export async function listSessions(): Promise<Session[]> {
  const response = await apiRequest<SessionResponse[]>("/auth/sessions");
  if (!Array.isArray(response)) {
    throw new ApiError("server", null, "The server sent an unexpected answer.");
  }
  return response.map(toSession);
}

/** Ending the current one also clears the cookie: this browser is signed out. */
export async function revokeSession(sessionId: string): Promise<void> {
  await apiRequest<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

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
