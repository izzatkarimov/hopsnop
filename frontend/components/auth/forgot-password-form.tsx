"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { TextField } from "@/components/ui/text-field";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { requestPasswordReset } from "@/lib/auth";
import { validateEmail } from "@/lib/auth-validation";
import { primaryActionClass, textLinkClass } from "./styles";

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
    <form
      method="post"
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <h1 className="text-2xl font-semibold tracking-tight">
        Reset your password
      </h1>
      <p className="text-muted">
        Enter the email address of your account, and we&apos;ll email you a
        link to choose a new password.
      </p>

      {formError && <Notice tone="error">{formError}</Notice>}
      {sent && (
        // Same answer whether or not an account exists, or a link was just sent.
        <Notice tone="info">
          If that address belongs to an account, we&apos;ve emailed it a link
          to reset your password. The link expires after a short time.
        </Notice>
      )}

      <TextField
        label="Email"
        type="email"
        name="email"
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

      <button type="submit" disabled={submitting} className={primaryActionClass}>
        {submitting ? "Sending…" : "Send reset link"}
      </button>

      <p className="text-center text-sm text-muted">
        <Link href="/login" className={textLinkClass}>
          Back to log in
        </Link>
      </p>
    </form>
  );
}
