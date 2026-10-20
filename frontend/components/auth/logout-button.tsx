"use client";

import { useState } from "react";
import { LogoutIcon } from "@/components/ui/icons";
import { useAuth } from "./auth-provider";

type LogoutButtonProps = {
  /** "icon" for tight spaces such as the sidebar; "button" elsewhere. */
  variant: "icon" | "button";
};

/**
 * Ends the session. Once the auth state says "signed out", RequireAuth
 * takes the user to the login page.
 */
export function LogoutButton({ variant }: LogoutButtonProps) {
  const { logOut } = useAuth();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick() {
    setPending(true);
    setFailed(false);
    try {
      await logOut();
    } catch {
      // The session may still be alive on the server, so the user stays
      // signed in here and is told that logging out did not work.
      setFailed(true);
      setPending(false);
    }
  }

  const error = failed && (
    <span role="alert" className="text-sm text-danger">
      Couldn&apos;t log out. Try again.
    </span>
  );

  if (variant === "icon") {
    return (
      <span className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          aria-label="Log out"
          title="Log out"
          className="rounded-full p-2 text-muted transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
        >
          <LogoutIcon width={20} height={20} />
        </button>
        {error}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-full border border-border px-5 py-2 font-semibold transition-colors hover:bg-hover disabled:opacity-50"
      >
        {pending ? "Logging out…" : "Log out"}
      </button>
      {error}
    </span>
  );
}
