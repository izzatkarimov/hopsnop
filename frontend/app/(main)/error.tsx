"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function MainError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Generic on purpose: internal error details are not exposed to users.
  return (
    <div role="alert">
      <EmptyState
        title="Something went wrong"
        description="We couldn't load this page. Please try again."
        action={
          <Button variant="primary" onClick={() => retry()}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
