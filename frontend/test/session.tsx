import { render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect } from "vitest";
import { AuthProvider, useAuth } from "@/components/auth/auth-provider";
import { api, json } from "./api";
import type { Reply } from "./api";
import { authState } from "./render";

/** The same probe as renderSignedIn's, so authState() reads it too. */
function AuthState() {
  const { status } = useAuth();
  return <span data-testid="auth-state">{status}</span>;
}

/**
 * Renders inside the real AuthProvider, with the session checks (GET
 * /auth/me) answered by `replies` in turn, as api.on does. Does not wait
 * for the answer, so the first check can still be on its way.
 */
export function renderWithSessionCheck(ui: ReactElement, ...replies: Reply[]) {
  api.on("GET", "/auth/me", ...replies);
  return render(
    <AuthProvider>
      <AuthState />
      {ui}
    </AuthProvider>,
  );
}

/**
 * Renders inside the real AuthProvider, signed out: GET /auth/me answers
 * 401. Resolves once the session check is done.
 */
export async function renderSignedOut(ui: ReactElement) {
  const result = renderWithSessionCheck(ui, json(401, { detail: "Not authenticated." }));
  await waitFor(() => expect(authState()).toBe("unauthenticated"));
  return result;
}
