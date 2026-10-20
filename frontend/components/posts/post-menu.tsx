"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CopyIcon, EditIcon, MoreIcon, TrashIcon } from "@/components/ui/icons";

type PostMenuProps = {
  content: string;
  /** Provided only while the viewer may edit the post (their own, recent). */
  onEdit?: () => void;
  /** Provided only when the viewer may delete the post (their own post). */
  onDelete?: () => void;
};

/** "More" button with a small dropdown of post actions. */
export function PostMenu({ content, onEdit, onDelete }: PostMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function getItems(): HTMLButtonElement[] {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? [],
    );
  }

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  // While open: move focus into the menu and close on outside clicks.
  useEffect(() => {
    if (!open) return;

    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = getItems();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close({ restoreFocus: true });
        break;
      case "Tab":
        setOpen(false);
        break;
      case "ArrowDown":
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
    }
  }

  async function handleCopy() {
    close({ restoreFocus: true });
    try {
      await navigator.clipboard.writeText(content);
    } catch (error) {
      // Clipboard access can be denied by the browser; not critical here.
      console.warn("Could not copy post text", error);
    }
  }

  function handleEdit() {
    setOpen(false);
    onEdit?.();
  }

  function handleDelete() {
    setOpen(false);
    onDelete?.();
  }

  const itemClass =
    "flex w-full items-center gap-3 px-4 py-2.5 text-left text-body font-medium hover:bg-hover focus-visible:bg-hover focus-visible:outline-none";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="-my-1.5 -mr-2 rounded-full p-1.5 text-muted transition-colors hover:bg-accent/10 hover:text-accent"
      >
        <MoreIcon width={18} height={18} />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Post options"
          onKeyDown={handleMenuKeyDown}
          className="absolute top-full right-0 z-30 mt-1 min-w-48 overflow-hidden rounded-xl border border-border bg-background py-1 shadow-lg shadow-black/5"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleCopy}
            className={itemClass}
          >
            <CopyIcon width={18} height={18} />
            Copy text
          </button>
          {onEdit && (
            <button
              type="button"
              role="menuitem"
              onClick={handleEdit}
              className={itemClass}
            >
              <EditIcon width={18} height={18} />
              Edit post
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              onClick={handleDelete}
              className={`${itemClass} text-danger`}
            >
              <TrashIcon width={18} height={18} />
              Delete post
            </button>
          )}
        </div>
      )}
    </div>
  );
}
