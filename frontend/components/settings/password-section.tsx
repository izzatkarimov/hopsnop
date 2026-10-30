"use client";

import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PasswordField } from "@/components/auth/password-field";
import { Notice } from "@/components/ui/notice";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { changePassword, isWrongCurrentPasswordError } from "@/lib/auth";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateNewPassword,
} from "@/lib/auth-validation";

const FIELDS = ["currentPassword", "newPassword", "confirmPassword"] as const;

type FieldName = (typeof FIELDS)[number];
type Values = Record<FieldName, string>;
type FieldErrors = Partial<Record<FieldName, string>>;

const EMPTY: Values = { currentPassword: "", newPassword: "", confirmPassword: "" };

const API_FIELDS: Record<string, FieldName> = {
  current_password: "currentPassword",
  new_password: "newPassword",
};

/** Checked exactly as typed; never trimmed. */
function validate(values: Values): FieldErrors {
  const errors: FieldErrors = {};
  if (values.currentPassword === "") {
    errors.currentPassword = "Enter your current password.";
  }
  const newPasswordError = validateNewPassword(values.newPassword);
  if (newPasswordError) errors.newPassword = newPasswordError;
  if (values.confirmPassword === "") {
    errors.confirmPassword = "Enter the new password again.";
  } else if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = "The passwords don't match.";
  }
  return errors;
}

function fieldErrorsFrom(error: unknown): FieldErrors {
  if (isWrongCurrentPasswordError(error)) {
    return { currentPassword: "Your current password is incorrect." };
  }
  const errors: FieldErrors = {};
  if (isApiError(error) && error.kind === "validation") {
    for (const [apiField, message] of Object.entries(error.fieldErrors)) {
      const field = API_FIELDS[apiField];
      if (field) errors[field] = message;
    }
  }
  return errors;
}

function focusFirstInvalid(form: HTMLFormElement, errors: FieldErrors): boolean {
  const field = FIELDS.find((name) => errors[name]);
  if (!field) return false;

  const control = form.elements.namedItem(field);
  if (control instanceof HTMLElement) control.focus();
  return true;
}

type PasswordSectionProps = {
  onChanged: () => void;
};

/** The backend sets a new cookie for this session and ends the others. */
export function PasswordSection({ onChanged }: PasswordSectionProps) {
  const { expireSession } = useAuth();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // A ref: `submitting` only changes on the next render, too late for a second submit.
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  function fieldProps(field: FieldName) {
    return {
      name: field,
      value: values[field],
      error: errors[field],
      required: true,
      onChange: (event: { target: { value: string } }) => {
        setValues((current) => ({ ...current, [field]: event.target.value }));
        // Also, "don't match" goes stale once the new password changes.
        setErrors((current) => ({
          ...current,
          [field]: undefined,
          ...(field === "newPassword" && { confirmPassword: undefined }),
        }));
        setChanged(false);
      },
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    // event.currentTarget is cleared after an await.
    const form = event.currentTarget;
    const found = validate(values);
    setErrors(found);
    setFormError(null);
    setChanged(false);
    if (focusFirstInvalid(form, found)) return;

    inFlight.current = true;
    setSubmitting(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
    } catch (error) {
      inFlight.current = false;
      setSubmitting(false);
      if (isApiError(error) && error.kind === "unauthenticated") {
        expireSession();
        return;
      }
      const rejected = fieldErrorsFrom(error);
      setErrors(rejected);
      if (!focusFirstInvalid(form, rejected)) {
        setFormError(
          isApiError(error) && error.kind === "validation"
            ? "Some details were not accepted. Check them and try again."
            : unexpectedErrorMessage(error),
        );
      }
      return;
    }

    inFlight.current = false;
    setSubmitting(false);
    setValues(EMPTY);
    setErrors({});
    setChanged(true);
    // The focused button was disabled; the heading is right above the message.
    headingRef.current?.focus();
    onChanged();
  }

  return (
    <section aria-labelledby={headingId} className="border-b border-border">
      {/* method="post": before JS loads, GET would put the passwords in the URL. */}
      <form
        method="post"
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 px-4 py-4"
      >
        <div className="flex flex-col gap-1">
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold"
          >
            Password
          </h2>
          <p className="text-body text-muted">
            Changing your password signs you out of all your other sessions.
            You stay signed in here.
          </p>
        </div>

        {changed && (
          <Notice tone="info">
            Your password has been changed. Any other sessions have been
            signed out.
          </Notice>
        )}
        {formError && <Notice tone="error">{formError}</Notice>}

        <PasswordField
          label="Current password"
          autoComplete="current-password"
          {...fieldProps("currentPassword")}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          hint={`Use ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`}
          {...fieldProps("newPassword")}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          {...fieldProps("confirmPassword")}
        />

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-accent px-5 py-1.5 text-body font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent"
          >
            {submitting ? "Changing password…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}
