import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";
import { IconCheck } from "./icons";

type CheckboxProps = Omit<ComponentProps<"input">, "type" | "id" | "className" | "children"> & {
  label: ReactNode;
  hint?: string;
  /** Replaces the hint, marks the box invalid and is linked to it. */
  error?: string | null;
};

export function Checkbox({ label, hint, error, ...inputProps }: CheckboxProps) {
  const id = useId();
  const messageId = useId();
  const message = error || hint;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 flex size-5 shrink-0">
          <input
            type="checkbox"
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={message ? messageId : undefined}
            className={`peer size-5 cursor-pointer appearance-none rounded bg-well inset-ring inset-shadow-well focus-ring motion-safe:transition checked:bg-accent checked:shadow-primary checked:inset-ring-highlight/12 checked:inset-shadow-[0_1px_0] checked:inset-shadow-highlight/24 disabled:cursor-not-allowed disabled:opacity-50 ${error ? "inset-ring-danger/56" : "inset-ring-edge/12"}`}
            {...inputProps}
          />
          <IconCheck
            size={16}
            className="pointer-events-none absolute inset-0.5 hidden text-white peer-checked:block"
          />
        </span>
        <label htmlFor={id} className="cursor-pointer text-body text-secondary">
          {label}
        </label>
      </div>
      {message && (
        <p
          id={messageId}
          className={`pl-8 text-meta font-medium ${error ? "text-danger" : "text-muted"}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
