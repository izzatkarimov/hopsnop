"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import { SessionError } from "./session-error";
import { SessionLoading } from "./session-loading";

/** Navigation, not protection: the backend refusing requests keeps data safe. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "unauthenticated") router.replace("/login");
  }, [auth.status, router]);

  if (auth.status === "authenticated") {
    return children;
  }

  if (auth.status === "error") {
    return <SessionError />;
  }

  return <SessionLoading />;
}
