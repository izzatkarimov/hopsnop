import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";

type FieldProps = {
  label: string;
  /** Shown below the field while there is no error. */
  hint?: string;
  error?: string | null;
  /** Small control shown next to the label, e.g. "Show" for a password. */
  labelAction?: ReactNode;
};

const controlClass =
  "mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-base placeholder:text-muted aria-invalid:border-danger";

/** The parts every field shares: label, message, and how they are linked. */
function useField({ label, hint, error, labelAction }: FieldProps) {
  const id = useId();
  const messageId = useId();
  const message = error || hint;

  return {
    labelRow: (
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {labelAction}
      </div>
    ),
    messageRow: message && (
      <p
        id={messageId}
        className={`mt-1 text-sm ${error ? "text-danger" : "text-muted"}`}
      >
        {message}
      </p>
    ),
    controlProps: {
      id,
      "aria-invalid": error ? (true as const) : undefined,
      "aria-describedby": message ? messageId : undefined,
      className: controlClass,
    },
  };
}

type TextFieldProps = Omit<ComponentProps<"input">, "id" | "className"> &
  FieldProps;

/** Labelled text input with an optional hint and error message. */
export function TextField({
  label,
  hint,
  error,
  labelAction,
  ...inputProps
}: TextFieldProps) {
  const field = useField({ label, hint, error, labelAction });

  return (
    <div>
      {field.labelRow}
      <input {...field.controlProps} {...inputProps} />
      {field.messageRow}
    </div>
  );
}

type TextAreaFieldProps = Omit<ComponentProps<"textarea">, "id" | "className"> &
  FieldProps;

/** The multi-line counterpart of TextField. */
export function TextAreaField({
  label,
  hint,
  error,
  labelAction,
  ...textAreaProps
}: TextAreaFieldProps) {
  const field = useField({ label, hint, error, labelAction });

  return (
    <div>
      {field.labelRow}
      <textarea
        {...field.controlProps}
        {...textAreaProps}
        className={`${controlClass} resize-none`}
      />
      {field.messageRow}
    </div>
  );
}
