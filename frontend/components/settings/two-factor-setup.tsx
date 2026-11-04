"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PasswordField } from "@/components/auth/password-field";
import { Notice } from "@/components/ui/notice";
import { QrCode } from "@/components/ui/qr-code";
import { TextField } from "@/components/ui/text-field";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import {
  confirmTwoFactor,
  isInvalidCodeError,
  isNoPendingTwoFactorError,
  isTwoFactorAlreadyOnError,
  isWrongCurrentPasswordError,
  startTwoFactor,
} from "@/lib/auth";
import { validateAppCode } from "@/lib/auth-validation";
import type { TwoFactorSetup as Setup } from "@/lib/types";
import { CopyButton } from "./copy-button";
import {
  outlineButtonClass,
  primaryButtonClass,
  stepHeadingClass,
} from "./styles";

const PASSWORD_FIELD = "setupPassword";
const CODE_FIELD = "setupCode";

type FieldErrors = { password?: string; code?: string };

type TwoFactorSetupProps = {
  onEnabled: (recoveryCodes: string[]) => void;
  onCancel: () => void;
  /** Turned on elsewhere meanwhile. */
  onOutOfDate: () => void;
};

/** Spaces every 4 characters; apps take the key with or without them. */
function grouped(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

function focusField(form: HTMLFormElement, name: string) {
  const control = form.elements.namedItem(name);
  if (control instanceof HTMLElement) control.focus();
}

/**
 * The password is kept from the first step until confirm, which needs it again,
 * and goes with this component when the flow ends.
 */
export function TwoFactorSetup({
  onEnabled,
  onCancel,
  onOutOfDate,
}: TwoFactorSetupProps) {
  const { expireSession } = useAuth();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref: `submitting` only changes on the next render.
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const scanning = setup !== null;

  useEffect(() => {
    headingRef.current?.focus();
  }, [scanning]);

  function startOver(found: FieldErrors, message: string | null) {
    setSetup(null);
    setPassword("");
    setCode("");
    setErrors(found);
    setFormError(message);
  }

  function handleFailure(error: unknown): boolean {
    if (isApiError(error) && error.kind === "unauthenticated") {
      expireSession();
      return true;
    }
    if (isTwoFactorAlreadyOnError(error)) {
      onOutOfDate();
      return true;
    }
    return false;
  }

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // event.currentTarget is cleared after an await.
    const form = event.currentTarget;
    setFormError(null);
    if (password === "") {
      setErrors({ password: "Enter your password." });
      focusField(form, PASSWORD_FIELD);
      return;
    }
    setErrors({});

    inFlight.current = true;
    setSubmitting(true);
    try {
      // Sent exactly as typed.
      setSetup(await startTwoFactor(password));
    } catch (error) {
      if (handleFailure(error)) return;
      const rejected = isWrongCurrentPasswordError(error)
        ? "Your password is incorrect."
        : isApiError(error) && error.kind === "validation"
          ? error.fieldErrors.password
          : undefined;
      if (rejected) {
        setErrors({ password: rejected });
        focusField(form, PASSWORD_FIELD);
      } else {
        setFormError(unexpectedErrorMessage(error));
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const form = event.currentTarget;
    setFormError(null);
    const invalid = validateAppCode(code);
    if (invalid) {
      setErrors({ code: invalid });
      focusField(form, CODE_FIELD);
      return;
    }
    setErrors({});

    inFlight.current = true;
    setSubmitting(true);
    let recoveryCodes: string[];
    try {
      recoveryCodes = await confirmTwoFactor(password, code);
    } catch (error) {
      inFlight.current = false;
      setSubmitting(false);
      if (handleFailure(error)) return;
      if (isInvalidCodeError(error)) {
        setErrors({ code: "That code didn't work. Enter the newest code from the app." });
        focusField(form, CODE_FIELD);
      } else if (isNoPendingTwoFactorError(error)) {
        startOver({}, "The setup expired. Enter your password to start again.");
      } else if (isWrongCurrentPasswordError(error)) {
        startOver({ password: "Your password is incorrect." }, null);
      } else {
        setFormError(unexpectedErrorMessage(error));
      }
      return;
    }
    onEnabled(recoveryCodes);
  }

  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !submitting) onCancel();
  };

  const buttons = (submitLabel: string, pendingLabel: string) => (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className={outlineButtonClass}
      >
        Cancel
      </button>
      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? pendingLabel : submitLabel}
      </button>
    </div>
  );

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      {setup === null ? (
        // method="post": before JS loads, GET would put the password in the URL.
        <form
          method="post"
          noValidate
          onSubmit={handleStart}
          onKeyDown={cancelOnEscape}
          className="flex flex-col gap-3"
        >
          <h3 id={headingId} ref={headingRef} tabIndex={-1} className={stepHeadingClass}>
            Turn on two-factor login
          </h3>
          <p className="text-body text-muted">
            You&apos;ll need an authenticator app on your phone. Logging in
            will then ask for a code from it as well as your password.
          </p>
          {formError && <Notice tone="error">{formError}</Notice>}
          <PasswordField
            label="Password"
            name={PASSWORD_FIELD}
            hint="Enter your password to confirm it's you."
            value={password}
            error={errors.password}
            onChange={(event) => {
              setPassword(event.target.value);
              setErrors({});
            }}
            autoComplete="current-password"
            required
          />
          {buttons("Continue", "Checking…")}
        </form>
      ) : (
        <form
          method="post"
          noValidate
          onSubmit={handleConfirm}
          onKeyDown={cancelOnEscape}
          className="flex flex-col gap-3"
        >
          <h3 id={headingId} ref={headingRef} tabIndex={-1} className={stepHeadingClass}>
            Scan the QR code
          </h3>
          <p className="text-body text-muted">
            Scan this with your authenticator app, then enter the 6-digit code
            the app shows, to check that it&apos;s set up.
          </p>
          {formError && <Notice tone="error">{formError}</Notice>}

          <QrCode
            value={setup.otpauthUri}
            label="QR code for your authenticator app. If you can't scan it, enter the setup key shown below it instead."
          />

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Setup key</p>
            {/* translate="no": page translation would send it to a third party. */}
            <code
              translate="no"
              className="break-all rounded-lg bg-hover px-3 py-2 font-mono text-body"
            >
              {grouped(setup.secret)}
            </code>
            <CopyButton
              text={setup.secret}
              label="Copy key"
              className={outlineButtonClass}
            />
          </div>

          <TextField
            label="Code from the app"
            name={CODE_FIELD}
            value={code}
            error={errors.code}
            onChange={(event) => {
              setCode(event.target.value);
              setErrors({});
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          {buttons("Turn on", "Turning on…")}
        </form>
      )}
    </div>
  );
}
