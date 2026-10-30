"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import { TextField } from "@/components/ui/text-field";

type PasswordFieldProps = Omit<
  ComponentProps<typeof TextField>,
  "type" | "labelAction"
>;

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
          {/* Named after the field, so each password field's button is distinct. */}
          <span className="sr-only"> {props.label.toLowerCase()}</span>
        </button>
      }
    />
  );
}
