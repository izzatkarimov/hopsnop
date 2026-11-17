"use client";

import { Button } from "@/components/ui/button";
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
          <Button variant="primary" onClick={retry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
