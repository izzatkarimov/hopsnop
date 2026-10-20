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
  /** No token in the URL: the page was not opened from a reset link. */
  | "missing"
  /** A token is held, and the new password can be chosen. */
  | "choosing"
  /** The backend refused the token: wrong, expired or already used. */
  | "invalid";

/** What a failed reset request means for the page. */
type Failure =
  | { type: "invalid_link" }
  /** The new password was not accepted; the token is still good. */
  | { type: "password"; message: string }
  /** The request itself failed; the token may still be good. */
  | { type: "unexpected"; message: string };

function failureOf(error: unknown): Failure {
  // The backend's answer for a token that cannot be used: unknown, expired,
  // already used, or of an account that is no longer active.
  if (isApiError(error) && error.kind === "bad_request") {
    return { type: "invalid_link" };
  }
  if (isApiError(error) && error.kind === "validation") {
    // A token the backend would not even look up: the link is damaged.
    if (error.fieldErrors.token) return { type: "invalid_link" };
    const message = error.fieldErrors.new_password;
    if (message) return { type: "password", message };
  }
  return { type: "unexpected", message: unexpectedErrorMessage(error) };
}

/** Moves focus to the password field, for a message about what is in it. */
function focusPassword(form: HTMLFormElement) {
  const input = form.elements.namedItem(PASSWORD_FIELD);
  if (input instanceof HTMLElement) input.focus();
}

/**
 * Handles the link from the password reset email: /reset-password?token=...
 *
 * The token is a single-use credential that sets the account's password. It
 * is read from the URL once, kept only in memory, sent to the backend in a
 * POST body, and never logged or stored. Unlike a verification token it is
 * not sent at once: the backend takes it together with the new password, so
 * whether it is still good is only known once the form has been submitted.
 */
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
  // Guards against sending the token twice. A ref, because it changes at
  // once: `submitting` only changes when React next renders.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!urlToken || token.current !== null) return;
    token.current = urlToken;

    // Take the token out of the address bar and the browser history.
    window.history.replaceState(null, "", window.location.pathname);
  }, [urlToken]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = token.current;
    if (inFlight.current || value === null) return;

    // Kept in a variable: event.currentTarget is cleared after an await.
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
        // Neither the token nor the password typed for it is of any use now.
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
    // The backend has ended every session of the account. If this browser
    // had a session, it may have been one of them, or it may belong to
    // another account: the session is checked again rather than assumed
    // either way.
    if (status !== "unauthenticated") retry();
    // The form stays disabled until the login page has taken over.
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
        // method="post" matters if the form is submitted before the page's
        // JavaScript has loaded: the browser's default (GET) would put the
        // password into the URL.
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
              // The message no longer describes what is in the field.
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
