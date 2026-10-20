"use client";

import { Suspense, useRef, useState } from "react";
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

type Failure =
  | { type: "missing" }
  | { type: "credentials" }
  | { type: "unverified" }
  | { type: "unexpected"; message: string };

export function LoginForm() {
  const { logIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Guards against logging in twice. A ref, because it changes at once:
  // `submitting` only changes when React next renders, which can be after a
  // second submit event has already arrived.
  const inFlight = useRef(false);

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
      // On success the auth state changes and GuestOnly, which wraps this
      // form, moves on to the application. The form stays disabled until then.
      await logIn({ identifier: identifier.trim(), password });
    } catch (error) {
      setFailure(toFailure(error));
      inFlight.current = false;
      setSubmitting(false);
    }
  }

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
        Log in to Hopsnop
      </h1>

      {/* The note reads the URL, which is only known in the browser. Its own
          boundary lets the rest of the form be prerendered without it. */}
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
  // A 422 here means the input could not belong to any account (for example
  // it is far too long), so it gets the same answer as wrong credentials.
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
    case "unexpected":
      return <Notice tone="error">{failure.message}</Notice>;
  }
}
