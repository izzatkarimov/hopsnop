"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconMail } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { resendVerification } from "@/lib/auth";
import { validateEmail } from "@/lib/auth-validation";

export function ResendVerificationForm() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const invalid = validateEmail(email);
    setEmailError(invalid);
    setFormError(null);
    setSent(false);
    if (invalid) return;

    setSubmitting(true);
    try {
      await resendVerification(email.trim());
      setSent(true);
    } catch (error) {
      if (isApiError(error) && error.kind === "validation") {
        setEmailError("Enter a valid email address.");
      } else {
        setFormError(unexpectedErrorMessage(error));
      }
    } finally {
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

      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? "Sending…" : "Send a new link"}
      </Button>

      {formError && <Notice tone="error">{formError}</Notice>}
      {sent && (
        // The backend answers the same whether or not the address has an account.
        <Notice tone="info">
          If that address belongs to an account that still needs verifying, a
          new link is on its way.
        </Notice>
      )}
    </form>
  );
}
