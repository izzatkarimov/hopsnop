"use client";

import type { ReactNode } from "react";
import { useAuth } from "./auth-provider";
import { SessionError } from "./session-error";
import { SessionLoading } from "./session-loading";

type AuthSwitchProps = {
  /** Shown to a signed-in user. */
  authenticated: ReactNode;
  /** Shown to a visitor the backend has confirmed has no session. */
  guest: ReactNode;
};

/**
 * For pages that are open to everyone but look different when signed in.
 * Unlike RequireAuth it never redirects: a visitor without a session simply
 * gets the guest version. Only a confirmed "signed out" leads there; when
 * the session could not be checked, the user may well be signed in, so they
 * are asked to try again instead.
 */
export function AuthSwitch({ authenticated, guest }: AuthSwitchProps) {
  const { status } = useAuth();

  if (status === "loading") return <SessionLoading />;
  if (status === "error") return <SessionError />;
  return status === "authenticated" ? authenticated : guest;
}
