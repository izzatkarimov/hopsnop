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

/** Moves focus to the email field, for a message about what is in it. */
function focusEmail(form: HTMLFormElement) {
  const input = form.elements.namedItem("email");
  if (input instanceof HTMLElement) input.focus();
}

/** Asks for an email with a link to choose a new password. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  // Guards against sending the request twice: the backend counts every
  // request against its limit, whatever the outcome. A ref, because it
  // changes at once: `submitting` only changes when React next renders.
  const inFlight = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // Kept in a variable: event.currentTarget is cleared after an await.
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
        // Worded to match what the backend actually promises: it gives the
        // same answer whether or not the address belongs to an account, and
        // sends no new link if it sent one a few minutes ago.
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
