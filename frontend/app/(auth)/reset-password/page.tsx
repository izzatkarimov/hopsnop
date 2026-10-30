import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetPassword } from "@/components/auth/reset-password";

// Served with "Referrer-Policy: no-referrer" (next.config.ts).
export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    // The token is in the URL, known only in the browser; this fallback is prerendered.
    <Suspense
      fallback={
        <p role="status" className="text-center text-muted">
          Loading…
        </p>
      }
    >
      <ResetPassword />
    </Suspense>
  );
}
