"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconMail } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { TextLink } from "@/components/ui/text-link";
import { isApiError, unexpectedErrorMessage } from "@/lib/api";
import { isUsernameTakenError, register } from "@/lib/auth";
import {
  PASSWORD_MIN_LENGTH,
  validateDisplayName,
  validateEmail,
  validateNewPassword,
  validateUsername,
} from "@/lib/auth-validation";
import { AuthCard, AuthHeading } from "./auth-screen";
import { PasswordField } from "./password-field";

const FIELDS = ["displayName", "username", "email", "password"] as const;

type Field = (typeof FIELDS)[number];
type Values = Record<Field, string>;
type FieldErrors = Partial<Record<Field, string>>;

const API_FIELDS: Record<string, Field> = {
  display_name: "displayName",
  username: "username",
  email: "email",
  password: "password",
};

function validate(values: Values): FieldErrors {
  const errors: FieldErrors = {};
  const results: Record<Field, string | null> = {
    displayName: validateDisplayName(values.displayName),
    username: validateUsername(values.username),
    email: validateEmail(values.email),
    password: validateNewPassword(values.password),
  };
  for (const field of FIELDS) {
    const error = results[field];
    if (error) errors[field] = error;
  }
  return errors;
}

function fieldErrorsFrom(error: unknown): FieldErrors {
  if (!isApiError(error)) return {};

  if (error.kind === "validation") {
    const errors: FieldErrors = {};
    for (const [apiField, message] of Object.entries(error.fieldErrors)) {
      const field = API_FIELDS[apiField];
      if (field) errors[field] = message;
    }
    return errors;
  }

  if (isUsernameTakenError(error)) {
    return { username: "That username is already taken." };
  }
  return {};
}

function formErrorFrom(error: unknown): string {
  if (isApiError(error) && error.kind === "conflict") {
    return "That username is already taken.";
  }
  if (isApiError(error) && error.kind === "validation") {
    return "Some details were not accepted. Check them and try again.";
  }
  return unexpectedErrorMessage(error);
}

function focusFirstInvalid(form: HTMLFormElement, errors: FieldErrors): boolean {
  const field = FIELDS.find((name) => errors[name]);
  if (!field) return false;

  const input = form.elements.namedItem(field);
  if (input instanceof HTMLElement) input.focus();
  return true;
}

export function RegisterForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    displayName: "",
    username: "",
    email: "",
    password: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref: `submitting` only changes on the next render, too late for a second submit.
  const inFlight = useRef(false);

  function fieldProps(field: Field) {
    return {
      name: field,
      value: values[field],
      error: errors[field],
      required: true,
      onChange: (event: { target: { value: string } }) => {
        setValues((current) => ({ ...current, [field]: event.target.value }));
        setErrors((current) => ({ ...current, [field]: undefined }));
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
    if (focusFirstInvalid(form, found)) return;

    inFlight.current = true;
    setSubmitting(true);
    try {
      await register({
        display_name: values.displayName.trim(),
        username: values.username.trim(),
        email: values.email.trim(),
        // Sent exactly as typed.
        password: values.password,
      });
      // No session yet: the backend requires a verified email first.
      router.push("/verify-email");
    } catch (error) {
      const rejected = fieldErrorsFrom(error);
      setErrors(rejected);
      if (!focusFirstInvalid(form, rejected)) {
        setFormError(formErrorFrom(error));
      }
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthCard note>
      {/* method="post": before JS loads, GET would put the password in the URL. */}
      <form
        method="post"
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-6"
      >
        <AuthHeading
          title="Create your account"
          description="It takes a minute. No ads, ever."
        />

        {formError && <Notice tone="error">{formError}</Notice>}

        <div className="flex flex-col gap-4">
          <div className="grid items-start gap-4 sm:grid-cols-2 sm:gap-3">
            <Field
              label="Display name"
              autoComplete="name"
              {...fieldProps("displayName")}
            />
            <Field
              label="Username"
              hint="3 to 30 letters, numbers or underscores."
              prefix="@"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              {...fieldProps("username")}
            />
          </div>
          <Field
            label="Email"
            type="email"
            prefix={<IconMail />}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            {...fieldProps("email")}
          />
          <PasswordField
            label="Password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            autoComplete="new-password"
            {...fieldProps("password")}
          />
        </div>

        <Button type="submit" variant="primary" size="lg" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>

        <p className="text-center text-body text-secondary">
          Already have an account? <TextLink href="/login">Log in</TextLink>
        </p>
      </form>
    </AuthCard>
  );
}
