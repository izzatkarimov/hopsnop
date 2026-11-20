"use client";

import { useId, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode, Ref, RefObject } from "react";
import { Button } from "./button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Full class names are listed so Tailwind can detect them. */
const widths = {
  sm: "max-w-100",
  md: "max-w-120",
  lg: "max-w-150",
  xl: "max-w-160",
  "2xl": "max-w-184",
};

type DialogProps = {
  /** Names the dialog; a panel also shows it in its header. */
  title: string;
  /** Called on Escape and Cancel; the parent unmounts the dialog to close it. */
  onClose: () => void;
  children: ReactNode;
  /**
   * "panel": a header, a body and a footer.
   * "fullscreen": only the children, over a darker backdrop, e.g. the story viewer.
   */
  variant?: "panel" | "fullscreen";
  footer?: ReactNode;
  /** The header's left side instead of Cancel, e.g. a back button. */
  headerStart?: ReactNode;
  /** The header's right side, e.g. "Step 1 of 2". */
  headerEnd?: ReactNode;
  /** False while something is being sent, or until the user may leave. */
  dismissible?: boolean;
  /** Focused on open; otherwise the dialog itself. */
  initialFocus?: RefObject<HTMLElement | null>;
  size?: keyof typeof widths;
  /** Runs first; a key it prevents the default of is left alone. */
  onKeyDown?: (event: KeyboardEvent<HTMLDialogElement>) => void;
  ref?: Ref<HTMLDialogElement>;
};

/** A modal <dialog>: open while mounted; focus goes back where it came from. */
export function Dialog({
  title,
  onClose,
  children,
  variant = "panel",
  footer,
  headerStart,
  headerEnd,
  dismissible = true,
  initialFocus,
  size = "md",
  onKeyDown,
  ref,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useImperativeHandle(ref, () => dialogRef.current as HTMLDialogElement, []);

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
    onKeyDown?.(event);
    // E.g. a menu inside that Escape closes first.
    if (event.defaultPrevented) return;

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

  const fullscreen = variant === "fullscreen";

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={fullscreen ? title : undefined}
      aria-labelledby={fullscreen ? undefined : titleId}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      className={
        fullscreen
          ? "m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-transparent p-0 text-white outline-hidden viewer-backdrop"
          : `m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${widths[size]} overscroll-contain rounded-shell bg-transparent p-2 text-primary outline-hidden surface-shell`
      }
    >
      {fullscreen ? (
        children
      ) : (
        <div className="flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-tile surface-tile">
          <header className="grid min-h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-edge/6 py-2 pr-5 pl-1">
            <div className="flex">
              {headerStart ??
                (dismissible && (
                  <Button variant="ghost" onClick={requestClose}>
                    Cancel
                  </Button>
                ))}
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
      )}
    </dialog>
  );
}
