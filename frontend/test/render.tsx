import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect } from "vitest";
import { AuthProvider, useAuth } from "@/components/auth/auth-provider";
import type { AccountResponse } from "@/lib/auth";
import { api, json } from "./api";

/** The signed-in account in component tests. Not a real person. */
export const account: AccountResponse = {
  id: "7d6f1d2e-7a2b-4c1f-9a0e-2b8d4e6f8a10",
  username: "test_viewer",
  email: "test_viewer@example.com",
  display_name: "Test Viewer",
  bio: null,
  avatar_url: null,
  is_active: true,
  email_verified_at: "2026-01-05T10:00:00.000000Z",
  created_at: "2026-01-05T09:00:00.000000Z",
};

/** Shows the auth state, so that a test can see a session end. */
function AuthState() {
  const { status } = useAuth();
  return <span data-testid="auth-state">{status}</span>;
}

/** The auth state as the app sees it: "authenticated", "unauthenticated", ... */
export function authState(): string | null {
  return screen.getByTestId("auth-state").textContent;
}

/**
 * Renders inside the real AuthProvider, signed in: GET /auth/me answers
 * with `account`. Resolves once the session check is done.
 */
export async function renderSignedIn(ui: ReactElement) {
  api.on("GET", "/auth/me", json(200, account));
  const result = render(
    <AuthProvider>
      <AuthState />
      {ui}
    </AuthProvider>,
  );
  await waitFor(() => expect(authState()).toBe("authenticated"));
  return result;
}
