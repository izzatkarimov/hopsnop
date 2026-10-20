import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { GuestOnly } from "@/components/auth/guest-only";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <GuestOnly>
      <ForgotPasswordForm />
    </GuestOnly>
  );
}
