import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata: Metadata = { title: "Verify your email" };

export default function VerifyEmailPage() {
  return (
    // The token is in the URL, known only in the browser; this fallback is prerendered.
    <Suspense
      fallback={
        <p role="status" className="text-center text-muted">
          Loading…
        </p>
      }
    >
      <VerifyEmail />
    </Suspense>
  );
}
