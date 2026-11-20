"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import type { ComponentType, KeyboardEvent, ReactNode, RefObject } from "react";
import type { IconProps } from "./icons";

/* Full class names are listed so Tailwind can detect them. */
const itemClass =
  "flex w-full items-center gap-3 rounded-item px-3 py-2 text-left text-body font-medium outline-hidden hover:bg-edge/6 focus-visible:bg-edge/6 focus-visible:inset-ring focus-visible:inset-ring-ink/72";

type MenuItemProps = {
  icon: ComponentType<IconProps>;
  label: string;
  danger?: boolean;
  onSelect: () => void;
};

export function MenuItem({ icon: Icon, label, danger, onSelect }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`${itemClass} ${danger ? "text-danger" : "text-primary"}`}
    >
      <Icon className="shrink-0" />
      {label}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-2 my-1 h-px bg-edge/6" />;
}

type MenuProps = {
  id: string;
  label: string;
  /** Escape gives focus back to the button that opened it; Tab and a click elsewhere don't. */
  onClose: (restoreFocus: boolean) => void;
  /** Holds the opening button too, so a click on it isn't a click elsewhere. */
  containerRef: RefObject<HTMLElement | null>;
  /** Where it sits, next to its button. */
  className: string;
  children: ReactNode;
};

/** A WAI-ARIA menu, open while mounted, with its first item focused. */
export function Menu({ id, label, onClose, containerRef, className, children }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeOutside = useEffectEvent(() => onClose(false));

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) closeOutside();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [containerRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    const index = items.indexOf(document.activeElement as HTMLElement);

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        onClose(true);
        break;
      case "Tab":
        onClose(false);
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

  return (
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={`z-30 flex w-64 flex-col rounded-popover p-2 text-primary surface-popover ${className}`}
    >
      {children}
    </div>
  );
}
