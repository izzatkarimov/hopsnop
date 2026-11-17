"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconEye, IconLock } from "@/components/ui/icons";

type PasswordFieldProps = Omit<
  ComponentProps<typeof Field>,
  "type" | "prefix" | "trailing"
>;

export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <Field
      {...props}
      type={visible ? "text" : "password"}
      prefix={<IconLock />}
      trailing={
        <IconButton
          // Named after the field, so each password field's button is distinct.
          label={`${visible ? "Hide" : "Show"} ${props.label.toLowerCase()}`}
          icon={<IconEye />}
          variant={visible ? "secondary" : "ghost"}
          size="sm"
          className="-mr-2"
          onClick={() => setVisible((value) => !value)}
        />
      }
    />
  );
}
