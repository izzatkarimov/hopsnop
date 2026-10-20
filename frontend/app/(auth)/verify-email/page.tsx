import { Suspense } from "react";
import type { Metadata } from "next";
import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata: Metadata = { title: "Verify your email" };

export default function VerifyEmailPage() {
  return (
    // VerifyEmail reads the token from the URL, which is only known in the
    // browser, so it renders there and this fallback is what gets prerendered.
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
