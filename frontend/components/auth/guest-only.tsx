"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";

/**
 * For pages that only make sense when signed out (log in, register).
 * A signed-in user is sent to the application instead, which is also what
 * moves the user on after a successful login.
 */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  if (status === "authenticated") {
    return (
      <p role="status" className="text-center text-muted">
        Taking you to Hopsnop…
      </p>
    );
  }
  return children;
}
