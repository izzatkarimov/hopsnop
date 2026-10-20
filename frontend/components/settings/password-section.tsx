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

/** The fields, in the order they appear. */
const FIELDS = ["currentPassword", "newPassword", "confirmPassword"] as const;

type FieldName = (typeof FIELDS)[number];
type Values = Record<FieldName, string>;
type FieldErrors = Partial<Record<FieldName, string>>;

const EMPTY: Values = { currentPassword: "", newPassword: "", confirmPassword: "" };

/** Field names in the backend's validation errors, mapped to this form's. */
const API_FIELDS: Record<string, FieldName> = {
  current_password: "currentPassword",
  new_password: "newPassword",
};

/** Passwords are checked exactly as typed; they are never trimmed. */
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

/** Moves focus to the first field with an error. False if there is none. */
function focusFirstInvalid(form: HTMLFormElement, errors: FieldErrors): boolean {
  const field = FIELDS.find((name) => errors[name]);
  if (!field) return false;

  const control = form.elements.namedItem(field);
  if (control instanceof HTMLElement) control.focus();
  return true;
}

type PasswordSectionProps = {
  /** Called once the password is changed, when the backend has ended every
      other session of the account. */
  onChanged: () => void;
};

/**
 * Changes the signed-in user's password. The current one has to be given.
 *
 * The backend ends every other session of the account and keeps this one,
 * under a new cookie that it sets itself; so the user stays signed in here
 * and nothing else needs to be done about sessions.
 *
 * The passwords are only held in this form's state while they are typed.
 * They are sent once, and cleared when the change has been made.
 */
export function PasswordSection({ onChanged }: PasswordSectionProps) {
  const { expireSession } = useAuth();
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Guards against sending the same change twice. A ref, because it changes
  // at once: `submitting` only changes when React next renders, which can be
  // after a second submit event has already arrived.
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
        // The message no longer describes what is in the field; nor does
        // "don't match" once the new password itself changes.
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

    // Kept in a variable: event.currentTarget is cleared after an await.
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
        // The session ended meanwhile. RequireAuth leads to the login page.
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
    // The button that had focus was disabled meanwhile; the heading is
    // right above the message that says what happened.
    headingRef.current?.focus();
    onChanged();
  }

  return (
    <section aria-labelledby={headingId} className="border-b border-border">
      {/* method="post" matters if the form is submitted before the page's
          JavaScript has loaded: the browser's default (GET) would put the
          passwords into the URL. */}
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
