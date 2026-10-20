"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { setFollow } from "@/lib/profiles";

type FollowButtonProps = {
  username: string;
  /** Whether the signed-in user follows this user, as the backend last said. */
  following: boolean;
  /** Called with what the backend answered: whether they follow them now. */
  onChange: (following: boolean) => void;
};

/**
 * Follows or unfollows a user. Only for a signed-in user looking at someone
 * else's profile. What it shows is always the backend's answer: nothing
 * changes until a request has succeeded.
 */
export function FollowButton({ username, following, onChange }: FollowButtonProps) {
  const { expireSession } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against sending the same request twice. A ref, because it changes
  // at once: `pending` only changes when React next renders.
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
        // The session ended. The page goes on as for a signed-out visitor.
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
