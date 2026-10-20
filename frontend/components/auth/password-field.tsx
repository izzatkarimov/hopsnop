"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import { TextField } from "@/components/ui/text-field";

type PasswordFieldProps = Omit<
  ComponentProps<typeof TextField>,
  "type" | "labelAction"
>;

/** Password input that can be revealed, so a typo can be spotted. */
export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      labelAction={
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="rounded text-sm font-medium text-muted hover:text-foreground"
        >
          {visible ? "Hide" : "Show"}
          {/* Named after the field, so that a form with several password
              fields has a distinct button for each. */}
          <span className="sr-only"> {props.label.toLowerCase()}</span>
        </button>
      }
    />
  );
}
