"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconBadge } from "@/components/ui/icon-badge";
import { IconArrowLeft, IconKey, IconMail } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { requestPasswordReset } from "@/lib/auth";
import { validateEmail } from "@/lib/auth-validation";
import { AuthCard, AuthHeading } from "./auth-screen";

function focusEmail(form: HTMLFormElement) {
  const input = form.elements.namedItem("email");
  if (input instanceof HTMLElement) input.focus();
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  // A ref: `submitting` only changes on the next render, too late for a second submit.
  const inFlight = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // event.currentTarget is cleared after an await.
    const form = event.currentTarget;
    const invalid = validateEmail(email);
    setEmailError(invalid);
    setFormError(null);
    setSent(false);
    if (invalid) {
      focusEmail(form);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (error) {
      if (isApiError(error) && error.kind === "validation") {
        setEmailError("Enter a valid email address.");
        focusEmail(form);
      } else {
        setFormError(unexpectedErrorMessage(error));
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthCard note>
      <form
        method="post"
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-6"
      >
        <AuthHeading
          badge={<IconBadge tone="warning" icon={<IconKey size={32} />} />}
          title="Reset your password"
          description="Enter your account's email. If it matches an account, we'll send a reset link."
        />

        {formError && <Notice tone="error">{formError}</Notice>}
        {sent && (
          // Same answer whether or not an account exists, or a link was just sent.
          <Notice tone="info">
            If that address belongs to an account, we&apos;ve emailed it a link
            to reset your password. The link expires after a short time.
          </Notice>
        )}

        <Field
          label="Email"
          type="email"
          name="email"
          prefix={<IconMail />}
          value={email}
          error={emailError}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailError(null);
          }}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
        />

        <Button type="submit" variant="primary" size="lg" disabled={submitting}>
          {submitting ? "Sending…" : "Send reset link"}
        </Button>

        <ButtonLink
          href="/login"
          variant="ghost"
          icon={<IconArrowLeft />}
          className="self-center"
        >
          Back to log in
        </ButtonLink>
      </form>
    </AuthCard>
  );
}
