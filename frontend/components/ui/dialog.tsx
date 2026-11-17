"use client";

import { useId, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { Button } from "./button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Full class names are listed so Tailwind can detect them. */
const widths = {
  sm: "max-w-100",
  md: "max-w-120",
  lg: "max-w-150",
};

type DialogProps = {
  /** Shown in the header and names the dialog. */
  title: string;
  /** Called on Escape and Cancel; the parent unmounts the dialog to close it. */
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** The header's right side, e.g. "Step 1 of 2". */
  headerEnd?: ReactNode;
  /** False while something is being sent, or until the user may leave. */
  dismissible?: boolean;
  /** Focused on open; otherwise the dialog itself. */
  initialFocus?: RefObject<HTMLElement | null>;
  size?: keyof typeof widths;
};

/** A modal <dialog>: open while mounted; focus goes back where it came from. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  headerEnd,
  dismissible = true,
  initialFocus,
  size = "md",
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!dialog.open) dialog.showModal();
    (initialFocus?.current ?? dialog).focus();

    return () => {
      // Closed first: while it's modal, the rest of the page can't take focus.
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [initialFocus]);

  function requestClose() {
    if (dismissible) onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      // Handled here so it works the same in every browser.
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((element) => !element.closest("[hidden], [inert]"));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${widths[size]} overscroll-contain rounded-shell bg-transparent p-2 text-primary outline-hidden surface-shell`}
    >
      <div className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-tile surface-tile">
        <header className="grid min-h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-edge/6 py-2 pr-5 pl-1">
          <div>
            {dismissible && (
              <Button variant="ghost" onClick={requestClose}>
                Cancel
              </Button>
            )}
          </div>
          <h2 id={titleId} className="text-center text-body font-semibold">
            {title}
          </h2>
          <div className="flex justify-end text-meta font-medium text-muted">
            {headerEnd}
          </div>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 pt-5 pb-4">{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-edge/6 py-3 pr-3 pl-5">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}
