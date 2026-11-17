"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { IconCheck } from "@/components/ui/icons";
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
    <div className="flex min-w-0 shrink-0 flex-col items-end gap-2">
      <Button
        onClick={handleClick}
        disabled={pending}
        aria-pressed={following}
        variant={following ? "secondary" : "primary"}
        icon={following ? <IconCheck /> : undefined}
      >
        {following ? "Following" : "Follow"}
      </Button>
      {error && (
        <p role="alert" className="text-right text-meta font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
