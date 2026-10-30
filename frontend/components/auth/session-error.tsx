"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { useAuth } from "./auth-provider";

/** The user may well be signed in, so this isn't the signed-out view. */
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
