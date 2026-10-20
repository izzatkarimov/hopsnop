"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "./auth-provider";

/**
 * Full-page message shown when the session could not be checked, e.g. the
 * API is unreachable. The user may well be signed in, so this is not the
 * signed-out view; trying again checks the session once more.
 */
export function SessionError() {
  const { retry } = useAuth();

  return (
    <div role="alert" className="flex min-h-dvh items-center justify-center">
      <EmptyState
        title="Couldn't load Hopsnop"
        description="We couldn't check whether you're signed in. Please try again."
        action={
          <button
            type="button"
            onClick={retry}
            className="rounded-full bg-accent px-5 py-2 font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            Try again
          </button>
        }
      />
    </div>
  );
}
