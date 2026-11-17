import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";

type FieldOwnProps = {
  label: string;
  hint?: string;
  /** Replaces the hint, marks the control invalid and is linked to it. */
  error?: string | null;
  /** Next to the label, e.g. a link. */
  labelAction?: ReactNode;
};

/* Full class names are listed so Tailwind can detect them. */

const boxClass =
  "flex w-full items-center gap-3 rounded-field bg-well px-4 inset-ring inset-shadow-well motion-safe:transition-shadow";

// The ring follows the text control only, not a button beside it.
const boxStateClass = {
  input: {
    valid: "inset-ring-edge/6 has-[input:focus-visible]:inset-ring-ink/72 has-[input:focus-visible]:ring-4 has-[input:focus-visible]:ring-accent/40",
    invalid: "inset-ring-danger/56 has-[input:focus-visible]:ring-4 has-[input:focus-visible]:ring-danger-solid/32",
  },
  textarea: {
    valid: "inset-ring-edge/6 has-[textarea:focus-visible]:inset-ring-ink/72 has-[textarea:focus-visible]:ring-4 has-[textarea:focus-visible]:ring-accent/40",
    invalid: "inset-ring-danger/56 has-[textarea:focus-visible]:ring-4 has-[textarea:focus-visible]:ring-danger-solid/32",
  },
};

const controlClass =
  "min-w-0 flex-1 bg-transparent text-primary outline-hidden placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50";

function useField({ label, hint, error, labelAction }: FieldOwnProps) {
  const id = useId();
  const messageId = useId();
  const message = error || hint;

  return {
    invalid: Boolean(error),
    labelRow: (
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-meta font-medium text-secondary">
          {label}
        </label>
        {labelAction}
      </div>
    ),
    messageRow: message && (
      <p
        id={messageId}
        className={`text-meta font-medium ${error ? "text-danger" : "text-muted"}`}
      >
        {message}
      </p>
    ),
    controlProps: {
      id,
      "aria-invalid": error ? (true as const) : undefined,
      "aria-describedby": message ? messageId : undefined,
    },
  };
}

type FieldProps = Omit<ComponentProps<"input">, "id" | "className" | "prefix"> &
  FieldOwnProps & {
    /** Before the text, e.g. an icon or "@"; hidden from assistive technology. */
    prefix?: ReactNode;
    /** After the text, e.g. a button. */
    trailing?: ReactNode;
    /** "code": larger, centred text for one-time codes. */
    appearance?: "default" | "code";
  };

export function Field({
  label,
  hint,
  error,
  labelAction,
  prefix,
  trailing,
  appearance = "default",
  ...inputProps
}: FieldProps) {
  const field = useField({ label, hint, error, labelAction });
  const state = field.invalid ? "invalid" : "valid";
  const code = appearance === "code";

  return (
    <div className="flex flex-col gap-2">
      {field.labelRow}
      <div
        className={`${boxClass} ${boxStateClass.input[state]} ${code ? "h-14" : "h-12"}`}
      >
        {prefix && (
          <span aria-hidden="true" className="flex shrink-0 text-muted">
            {prefix}
          </span>
        )}
        <input
          {...field.controlProps}
          {...inputProps}
          className={`${controlClass} h-full ${code ? "text-center text-title font-semibold" : "text-body"}`}
        />
        {trailing}
      </div>
      {field.messageRow}
    </div>
  );
}

type TextAreaFieldProps = Omit<ComponentProps<"textarea">, "id" | "className"> &
  FieldOwnProps;

export function TextAreaField({
  label,
  hint,
  error,
  labelAction,
  ...textAreaProps
}: TextAreaFieldProps) {
  const field = useField({ label, hint, error, labelAction });
  const state = field.invalid ? "invalid" : "valid";

  return (
    <div className="flex flex-col gap-2">
      {field.labelRow}
      <div className={`${boxClass} ${boxStateClass.textarea[state]} py-3`}>
        <textarea
          {...field.controlProps}
          {...textAreaProps}
          className={`${controlClass} resize-none text-body`}
        />
      </div>
      {field.messageRow}
    </div>
  );
}
