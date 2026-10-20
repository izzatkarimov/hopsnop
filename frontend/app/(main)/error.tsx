"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
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

  // Show a generic message: internal error details are not exposed to users.
  return (
    <div role="alert">
      <EmptyState
        title="Something went wrong"
        description="We couldn't load this page. Please try again."
        action={
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-full bg-accent px-5 py-2 font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            Try again
          </button>
        }
      />
    </div>
  );
}
