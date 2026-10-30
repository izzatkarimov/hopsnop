"use client";

import type { ReactNode } from "react";
import { useAuth } from "./auth-provider";
import { SessionError } from "./session-error";
import { SessionLoading } from "./session-loading";

type AuthSwitchProps = {
  authenticated: ReactNode;
  guest: ReactNode;
};

/** Never redirects; when the session can't be checked, asks the user to retry. */
export function AuthSwitch({ authenticated, guest }: AuthSwitchProps) {
  const { status } = useAuth();

  if (status === "loading") return <SessionLoading />;
  if (status === "error") return <SessionError />;
  return status === "authenticated" ? authenticated : guest;
}
