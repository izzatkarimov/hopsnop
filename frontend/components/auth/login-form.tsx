"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { TextField } from "@/components/ui/text-field";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { isEmailNotVerifiedError } from "@/lib/auth";
import { useAuth } from "./auth-provider";
import { PasswordField } from "./password-field";
import { PasswordResetNotice } from "./password-reset-notice";
import { primaryActionClass, textLinkClass } from "./styles";
import { TwoFactorLoginStep } from "./two-factor-login-step";

type Failure =
  | { type: "missing" }
  | { type: "credentials" }
  | { type: "unverified" }
  | { type: "expired" }
  | { type: "unexpected"; message: string };

/** The challenge lives here only: never in the URL, storage or a log. */
type Step = { name: "password" } | { name: "code"; challenge: string };

export function LoginForm() {
  const { logIn } = useAuth();
  const [step, setStep] = useState<Step>({ name: "password" });
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // A ref: `submitting` only changes on the next render, too late for a second submit.
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Only when coming back from the code step, not on the page's first load.
  const focusHeading = useRef(false);

  useEffect(() => {
    if (step.name !== "password" || !focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus();
  }, [step]);

  function backToPassword(reason: Failure | null) {
    focusHeading.current = true;
    setFailure(reason);
    setStep({ name: "password" });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    if (identifier.trim() === "" || password === "") {
      setFailure({ type: "missing" });
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      // GuestOnly moves on once auth state changes; the form stays disabled until then.
      const pending = await logIn({ identifier: identifier.trim(), password });
      if (pending) {
        // An expired challenge needs a new login, so the password isn't kept.
        setPassword("");
        setStep({ name: "code", challenge: pending.challenge });
        inFlight.current = false;
        setSubmitting(false);
      }
    } catch (error) {
      setFailure(toFailure(error));
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (step.name === "code") {
    return (
      <TwoFactorLoginStep
        challenge={step.challenge}
        onBack={() => backToPassword(null)}
        onExpired={() => backToPassword({ type: "expired" })}
      />
    );
  }

  return (
    // method="post": before JS loads, GET would put the password in the URL.
    <form
      method="post"
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold tracking-tight"
      >
        Log in to Hopsnop
      </h1>

      {/* Reads the URL, browser-only; its boundary lets the rest prerender. */}
      <Suspense fallback={null}>
        <PasswordResetNotice />
      </Suspense>
      {failure && <FailureNotice failure={failure} />}

      <TextField
        label="Username or email"
        name="identifier"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
      />
      <PasswordField
        label="Password"
        name="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        required
      />

      <button type="submit" disabled={submitting} className={primaryActionClass}>
        {submitting ? "Logging in…" : "Log in"}
      </button>

      <p className="text-center text-sm">
        <Link href="/forgot-password" className={textLinkClass}>
          Forgot password?
        </Link>
      </p>

      <p className="text-center text-sm text-muted">
        New to Hopsnop?{" "}
        <Link href="/register" className={textLinkClass}>
          Create an account
        </Link>
      </p>
    </form>
  );
}

function toFailure(error: unknown): Failure {
  if (isEmailNotVerifiedError(error)) {
    return { type: "unverified" };
  }
  // A 422 means input no account could have, so it's answered as wrong credentials.
  if (
    isApiError(error) &&
    (error.kind === "unauthenticated" || error.kind === "validation")
  ) {
    return { type: "credentials" };
  }
  return { type: "unexpected", message: unexpectedErrorMessage(error) };
}

function FailureNotice({ failure }: { failure: Failure }) {
  switch (failure.type) {
    case "missing":
      return (
        <Notice tone="error">
          Enter your username or email and your password.
        </Notice>
      );
    case "credentials":
      return (
        <Notice tone="error">Incorrect username, email or password.</Notice>
      );
    case "unverified":
      return (
        <Notice tone="info">
          Your email address isn&apos;t verified yet. Open the link we emailed
          you, or{" "}
          <Link href="/verify-email" className={textLinkClass}>
            request a new verification link
          </Link>
          .
        </Notice>
      );
    case "expired":
      return (
        <Notice tone="error">
          That login has expired, or too many wrong codes were entered. Enter
          your password to try again.
        </Notice>
      );
    case "unexpected":
      return <Notice tone="error">{failure.message}</Notice>;
  }
}
