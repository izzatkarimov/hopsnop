"use client";

import { useState } from "react";

type CopyButtonProps = {
  text: string;
  label: string;
  className: string;
};

export function CopyButton({ text, label, className }: CopyButtonProps) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setResult("copied");
    } catch {
      // Nothing logged: the text is a secret.
      setResult("failed");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={copy} className={className}>
        {label}
      </button>
      {/* Always present, so the message is announced when it appears. */}
      <span
        role="status"
        className={`text-sm ${result === "failed" ? "text-danger" : "text-muted"}`}
      >
        {result === "copied" && "Copied."}
        {result === "failed" &&
          "Couldn't copy. Select the text and copy it yourself."}
      </span>
    </div>
  );
}
