import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetPassword } from "@/components/auth/reset-password";

// The page is served with "Referrer-Policy: no-referrer" (next.config.ts).
export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    // ResetPassword reads the token from the URL, which is only known in the
    // browser, so it renders there and this fallback is what gets prerendered.
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
