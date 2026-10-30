"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Notice } from "@/components/ui/notice";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { resetPassword } from "@/lib/auth";
import {
  PASSWORD_MIN_LENGTH,
  validateNewPassword,
} from "@/lib/auth-validation";
import { useAuth } from "./auth-provider";
import { AuthScreen } from "./auth-screen";
import { PasswordField } from "./password-field";
import { LOGIN_AFTER_PASSWORD_RESET } from "./password-reset-notice";
import { primaryActionClass, textLinkClass } from "./styles";

const PASSWORD_FIELD = "newPassword";

type Phase =
  | "missing"
  | "choosing"
  | "invalid";

type Failure =
  | { type: "invalid_link" }
  | { type: "password"; message: string }
  /** The request itself failed; the token may still be good. */
  | { type: "unexpected"; message: string };

function failureOf(error: unknown): Failure {
  // Unknown, expired, used, or of an inactive account.
  if (isApiError(error) && error.kind === "bad_request") {
    return { type: "invalid_link" };
  }
  if (isApiError(error) && error.kind === "validation") {
    // A token the backend wouldn't even look up: the link is damaged.
    if (error.fieldErrors.token) return { type: "invalid_link" };
    const message = error.fieldErrors.new_password;
    if (message) return { type: "password", message };
  }
  return { type: "unexpected", message: unexpectedErrorMessage(error) };
}

function focusPassword(form: HTMLFormElement) {
  const input = form.elements.namedItem(PASSWORD_FIELD);
  if (input instanceof HTMLElement) input.focus();
}

/** The token is read once, kept in memory, POSTed, and never logged or stored. */
export function ResetPassword() {
  const urlToken = useSearchParams().get("token");
  const token = useRef<string | null>(null);
  const { status, retry } = useAuth();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(urlToken ? "choosing" : "missing");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref: `submitting` only changes on the next render, too late for a second submit.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!urlToken || token.current !== null) return;
    token.current = urlToken;

    // Take the token out of the address bar and history.
    window.history.replaceState(null, "", window.location.pathname);
  }, [urlToken]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = token.current;
    if (inFlight.current || value === null) return;

    // event.currentTarget is cleared after an await.
    const form = event.currentTarget;
    const invalid = validateNewPassword(password);
    setPasswordError(invalid);
    setFormError(null);
    if (invalid) {
      focusPassword(form);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    try {
      // Sent exactly as typed.
      await resetPassword(value, password);
    } catch (error) {
      const failure = failureOf(error);
      inFlight.current = false;
      setSubmitting(false);
      if (failure.type === "invalid_link") {
        token.current = null;
        setPassword("");
        setPhase("invalid");
      } else if (failure.type === "password") {
        setPasswordError(failure.message);
        focusPassword(form);
      } else {
        setFormError(failure.message);
      }
      return;
    }

    token.current = null;
    // Every session ended, perhaps this browser's: check again rather than assume.
    if (status !== "unauthenticated") retry();
    // Disabled until the login page has taken over.
    router.replace(LOGIN_AFTER_PASSWORD_RESET);
  }

  switch (phase) {
    case "missing":
      return (
        <AuthScreen title="Reset your password">
          <p className="text-muted">
            To choose a new password, open the link in the password reset
            email we sent you. If you don&apos;t have one, or it no longer
            works, request a new link.
          </p>
          <Link href="/forgot-password" className={primaryActionClass}>
            Request a new link
          </Link>
          <p className="text-center text-sm text-muted">
            <Link href="/login" className={textLinkClass}>
              Back to log in
            </Link>
          </p>
        </AuthScreen>
      );

    case "invalid":
      return (
        <AuthScreen title="This link didn't work">
          <Notice tone="error">
            The password reset link is invalid or has expired.
          </Notice>
          <p className="text-muted">
            A reset link works only once and for a limited time, and only the
            most recent one we sent you is valid. If you have already chosen
            a new password with this link, you can{" "}
            <Link href="/login" className={textLinkClass}>
              log in
            </Link>{" "}
            with it. Otherwise, request a new link.
          </p>
          <Link href="/forgot-password" className={primaryActionClass}>
            Request a new link
          </Link>
        </AuthScreen>
      );

    case "choosing":
      return (
        // method="post": before JS loads, GET would put the password in the URL.
        <form
          method="post"
          noValidate
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
        >
          <h1 className="text-2xl font-semibold tracking-tight">
            Choose a new password
          </h1>
          <p className="text-muted">
            Once your password is reset, you&apos;ll be logged out on all
            devices.
          </p>

          {formError && <Notice tone="error">{formError}</Notice>}

          <PasswordField
            label="New password"
            name={PASSWORD_FIELD}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            value={password}
            error={passwordError}
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordError(null);
            }}
            autoComplete="new-password"
            required
          />

          <button
            type="submit"
            disabled={submitting}
            className={primaryActionClass}
          >
            {submitting ? "Resetting password…" : "Reset password"}
          </button>

          <p className="text-center text-sm text-muted">
            <Link href="/login" className={textLinkClass}>
              Back to log in
            </Link>
          </p>
        </form>
      );
  }
}
