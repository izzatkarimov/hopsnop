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

export function renderWithSessionCheck(ui: ReactElement, ...replies: Reply[]) {
  api.on("GET", "/auth/me", ...replies);
  return render(
    <AuthProvider>
      <AuthState />
      {ui}
    </AuthProvider>,
  );
}

export async function renderSignedOut(ui: ReactElement) {
  const result = renderWithSessionCheck(ui, json(401, { detail: "Not authenticated." }));
  await waitFor(() => expect(authState()).toBe("unauthenticated"));
  return result;
}
