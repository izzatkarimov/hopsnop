"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Notice } from "@/components/ui/notice";
import { TextField } from "@/components/ui/text-field";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { isInvalidCodeError, isInvalidLoginChallengeError } from "@/lib/auth";
import { validateAppOrRecoveryCode } from "@/lib/auth-validation";
import { useAuth } from "./auth-provider";
import { primaryActionClass, textLinkClass } from "./styles";

const CODE_FIELD = "code";

type TwoFactorLoginStepProps = {
  challenge: string;
  onBack: () => void;
  /** The backend no longer takes this challenge: a new login is needed. */
  onExpired: () => void;
};

export function TwoFactorLoginStep({
  challenge,
  onBack,
  onExpired,
}: TwoFactorLoginStepProps) {
  const { logInWithCode } = useAuth();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref: `submitting` only changes on the next render.
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function showCodeError(form: HTMLFormElement, message: string) {
    setCodeError(message);
    const input = form.elements.namedItem(CODE_FIELD);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // event.currentTarget is cleared after an await.
    const form = event.currentTarget;
    setFormError(null);
    const invalid = validateAppOrRecoveryCode(code);
    if (invalid) {
      showCodeError(form, invalid);
      return;
    }
    setCodeError(null);

    inFlight.current = true;
    setSubmitting(true);
    try {
      // GuestOnly moves on once auth state changes; the form stays disabled until then.
      await logInWithCode(challenge, code);
    } catch (error) {
      inFlight.current = false;
      setSubmitting(false);
      if (isInvalidCodeError(error)) {
        showCodeError(form, "That code didn't work. Check it and try again.");
        return;
      }
      // The code was checked above, so a 422 is about the challenge.
      if (
        isInvalidLoginChallengeError(error) ||
        (isApiError(error) &&
          (error.kind === "unauthenticated" || error.kind === "validation"))
      ) {
        onExpired();
        return;
      }
      setFormError(unexpectedErrorMessage(error));
    }
  }

  return (
    // method="post": before JS loads, GET would put the code in the URL.
    <form
      method="post"
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight"
        >
          Enter your login code
        </h1>
        <p className="text-body text-muted">
          Two-factor login is on for this account. Enter the 6-digit code from
          your authenticator app.
        </p>
      </div>

      {formError && <Notice tone="error">{formError}</Notice>}

      {/* No inputMode: a numeric keypad couldn't type a recovery code. */}
      <TextField
        label="Code"
        name={CODE_FIELD}
        hint="Can't use the app? Enter one of your recovery codes instead."
        value={code}
        error={codeError}
        onChange={(event) => {
          setCode(event.target.value);
          setCodeError(null);
        }}
        autoComplete="one-time-code"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />

      <button type="submit" disabled={submitting} className={primaryActionClass}>
        {submitting ? "Verifying…" : "Verify"}
      </button>

      <p className="text-center text-sm">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className={`${textLinkClass} disabled:opacity-50`}
        >
          Back to log in
        </button>
      </p>
    </form>
  );
}
