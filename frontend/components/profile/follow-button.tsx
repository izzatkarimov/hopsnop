"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { setFollow } from "@/lib/profiles";

type FollowButtonProps = {
  username: string;
  following: boolean;
  onChange: (following: boolean) => void;
};

/** Shows only the backend's answer: nothing changes until a request succeeds. */
export function FollowButton({ username, following, onChange }: FollowButtonProps) {
  const { expireSession } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref: `pending` only changes on the next render.
  const inFlight = useRef(false);

  async function handleClick() {
    if (inFlight.current) return;

    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      onChange(await setFollow(username, !following));
    } catch (error) {
      if (isApiError(error) && error.kind === "unauthenticated") {
        expireSession();
        return;
      }
      setError(
        isApiError(error) && error.kind === "not_found"
          ? "This account is no longer available."
          : unexpectedErrorMessage(error),
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-pressed={following}
        className={`rounded-full px-4 py-1.5 text-body font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          following
            ? "border border-border hover:bg-hover"
            : "border border-transparent bg-accent text-accent-foreground hover:bg-accent-hover disabled:hover:bg-accent"
        }`}
      >
        {following ? "Following" : "Follow"}
      </button>
      {error && (
        <p role="alert" className="text-right text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
