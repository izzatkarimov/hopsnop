"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PasswordField } from "@/components/auth/password-field";
import { Notice } from "@/components/ui/notice";
import { TextField } from "@/components/ui/text-field";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import {
  isInvalidCodeError,
  isTwoFactorOffError,
  isWrongCurrentPasswordError,
} from "@/lib/auth";
import { validateAppCode, validateAppOrRecoveryCode } from "@/lib/auth-validation";
import {
  dangerButtonClass,
  outlineButtonClass,
  primaryButtonClass,
  stepHeadingClass,
} from "./styles";

const FIELDS = ["password", "code", "understood"] as const;

type FieldName = (typeof FIELDS)[number];
type FieldErrors = Partial<Record<FieldName, string>>;

function focusFirstInvalid(form: HTMLFormElement, errors: FieldErrors): boolean {
  const field = FIELDS.find((name) => errors[name]);
  if (!field) return false;

  const control = form.elements.namedItem(field);
  if (control instanceof HTMLElement) control.focus();
  return true;
}

const TEXT = {
  replace: {
    heading: "Replace recovery codes",
    intro:
      "You'll get a new set of recovery codes, and the ones you have now will stop working.",
    codeLabel: "Code from your authenticator app",
    codeHint: undefined,
    submit: "Replace codes",
    pending: "Replacing…",
  },
  disable: {
    heading: "Turn off two-factor login",
    intro:
      "Logging in will need only your password again, and your recovery codes will stop working.",
    codeLabel: "Code",
    codeHint: "From your authenticator app, or one of your recovery codes.",
    submit: "Turn off two-factor login",
    pending: "Turning off…",
  },
} as const;

type TwoFactorConfirmFormProps = {
  kind: "replace" | "disable";
  /** Makes the request and moves on; what it throws is shown here. */
  submit: (password: string, code: string) => Promise<void>;
  onCancel: () => void;
  /** Turned off elsewhere meanwhile. */
  onOutOfDate: () => void;
};

/** Password and code, both sent as typed; turning off is confirmed like deleting the account. */
export function TwoFactorConfirmForm({
  kind,
  submit,
  onCancel,
  onOutOfDate,
}: TwoFactorConfirmFormProps) {
  const { expireSession } = useAuth();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref: `submitting` only changes on the next render.
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const understoodId = useId();
  const understoodMessageId = useId();
  const text = TEXT[kind];
  const disabling = kind === "disable";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function clearError(field: FieldName) {
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // event.currentTarget is cleared after an await.
    const form = event.currentTarget;
    const found: FieldErrors = {};
    if (password === "") found.password = "Enter your password.";
    const codeError = disabling ? validateAppOrRecoveryCode(code) : validateAppCode(code);
    if (codeError) found.code = codeError;
    if (disabling && !understood) {
      found.understood = "Confirm that you want to turn off two-factor login.";
    }
    setErrors(found);
    setFormError(null);
    if (focusFirstInvalid(form, found)) return;

    inFlight.current = true;
    setSubmitting(true);
    try {
      await submit(password, code);
    } catch (error) {
      inFlight.current = false;
      setSubmitting(false);
      if (isApiError(error) && error.kind === "unauthenticated") {
        expireSession();
        return;
      }
      if (isTwoFactorOffError(error)) {
        onOutOfDate();
        return;
      }
      const rejected: FieldErrors = isWrongCurrentPasswordError(error)
        ? { password: "Your password is incorrect." }
        : isInvalidCodeError(error)
          ? { code: "That code didn't work. Check it and try again." }
          : isApiError(error) && error.kind === "validation" && error.fieldErrors.password
            ? { password: error.fieldErrors.password }
            : {};
      setErrors(rejected);
      if (!focusFirstInvalid(form, rejected)) {
        setFormError(unexpectedErrorMessage(error));
      }
    }
  }

  return (
    // method="post": before JS loads, GET would put the password in the URL.
    <form
      method="post"
      noValidate
      onSubmit={handleSubmit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !submitting) onCancel();
      }}
      aria-labelledby={headingId}
      className={`flex flex-col gap-3 rounded-lg border p-3 ${
        disabling ? "border-danger/40" : "border-border"
      }`}
    >
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className={stepHeadingClass}>
        {text.heading}
      </h3>
      <p className="text-body text-muted">{text.intro}</p>
      {formError && <Notice tone="error">{formError}</Notice>}

      <PasswordField
        label="Password"
        name="password"
        hint="Enter your password to confirm it's you."
        value={password}
        error={errors.password}
        onChange={(event) => {
          setPassword(event.target.value);
          clearError("password");
        }}
        autoComplete="current-password"
        required
      />
      {/* Only an app code is taken for replacing, so a numeric keypad fits there. */}
      <TextField
        label={text.codeLabel}
        name="code"
        hint={text.codeHint}
        value={code}
        error={errors.code}
        onChange={(event) => {
          setCode(event.target.value);
          clearError("code");
        }}
        inputMode={disabling ? undefined : "numeric"}
        autoComplete="one-time-code"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />

      {disabling && (
        <div>
          <div className="flex items-start gap-2">
            <input
              id={understoodId}
              name="understood"
              type="checkbox"
              checked={understood}
              onChange={(event) => {
                setUnderstood(event.target.checked);
                clearError("understood");
              }}
              aria-invalid={errors.understood ? true : undefined}
              aria-describedby={errors.understood ? understoodMessageId : undefined}
              className="mt-0.5 size-4 shrink-0 accent-danger"
            />
            <label htmlFor={understoodId} className="text-sm">
              I understand that logging in will need only my password.
            </label>
          </div>
          {errors.understood && (
            <p id={understoodMessageId} className="mt-1 text-sm text-danger">
              {errors.understood}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className={outlineButtonClass}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={disabling ? dangerButtonClass : primaryButtonClass}
        >
          {submitting ? text.pending : text.submit}
        </button>
      </div>
    </form>
  );
}
