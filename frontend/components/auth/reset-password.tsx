"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { IconBadge } from "@/components/ui/icon-badge";
import { IconArrowLeft, IconKey, IconWarning } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { TextLink } from "@/components/ui/text-link";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { resetPassword } from "@/lib/auth";
import {
  PASSWORD_MIN_LENGTH,
  validateNewPassword,
} from "@/lib/auth-validation";
import { useAuth } from "./auth-provider";
import { AuthCard, AuthHeading, AuthScreen } from "./auth-screen";
import { PasswordField } from "./password-field";
import { LOGIN_AFTER_PASSWORD_RESET } from "./password-reset-notice";

const keyBadge = <IconBadge tone="warning" icon={<IconKey size={32} />} />;

const backToLogIn = (
  <ButtonLink href="/login" variant="ghost" icon={<IconArrowLeft />} className="self-center">
    Back to log in
  </ButtonLink>
);

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
        <AuthScreen
          badge={keyBadge}
          title="Reset your password"
          description="To choose a new password, open the link in the password reset email we sent you. If you don't have one, or it no longer works, request a new link."
        >
          <ButtonLink href="/forgot-password" variant="primary" size="lg">
            Request a new link
          </ButtonLink>
          {backToLogIn}
        </AuthScreen>
      );

    case "invalid":
      return (
        <AuthScreen
          badge={<IconBadge tone="danger" icon={<IconWarning size={32} />} />}
          title="This link didn't work"
        >
          <Notice tone="error">
            The password reset link is invalid or has expired.
          </Notice>
          <p className="text-body text-secondary">
            A reset link works only once and for a limited time, and only the
            most recent one we sent you is valid. If you have already chosen
            a new password with this link, you can{" "}
            <TextLink href="/login">log in</TextLink> with it. Otherwise,
            request a new link.
          </p>
          <ButtonLink href="/forgot-password" variant="primary" size="lg">
            Request a new link
          </ButtonLink>
        </AuthScreen>
      );

    case "choosing":
      return (
        <AuthCard>
          {/* method="post": before JS loads, GET would put the password in the URL. */}
          <form
            method="post"
            noValidate
            onSubmit={handleSubmit}
            className="flex flex-col gap-6"
          >
            <AuthHeading
              badge={keyBadge}
              title="Choose a new password"
              description="Once your password is reset, you'll be logged out on all devices."
            />

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

            <Button type="submit" variant="primary" size="lg" disabled={submitting}>
              {submitting ? "Resetting password…" : "Reset password"}
            </Button>

            {backToLogIn}
          </form>
        </AuthCard>
      );
  }
}
