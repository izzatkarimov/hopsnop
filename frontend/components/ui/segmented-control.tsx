"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";

export type Segment<T extends string> = {
  id: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  /** Names the group for assistive technology. */
  label: string;
  /** Prefix of the tab and panel ids; see segmentTabId and segmentPanelId. */
  idPrefix: string;
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function segmentTabId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

export function segmentPanelId(idPrefix: string, id: string): string {
  return `${idPrefix}-panel-${id}`;
}

/** The WAI-ARIA tabs pattern: the caller renders the selected segment's panel. */
export function SegmentedControl<T extends string>({
  label,
  idPrefix,
  segments,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = segments.findIndex((segment) => segment.id === value);
    let next: number | null = null;

    if (event.key === "ArrowRight") next = (index + 1) % segments.length;
    if (event.key === "ArrowLeft") next = (index - 1 + segments.length) % segments.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = segments.length - 1;
    if (next === null) return;

    event.preventDefault();
    onChange(segments[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className="inline-flex gap-1 rounded-full surface-well p-1"
    >
      {segments.map((segment, index) => {
        const selected = segment.id === value;
        return (
          <button
            key={segment.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={segmentTabId(idPrefix, segment.id)}
            aria-selected={selected}
            // Only the selected segment's panel is rendered.
            aria-controls={selected ? segmentPanelId(idPrefix, segment.id) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(segment.id)}
            className={`h-9 rounded-full px-4 text-control focus-ring motion-safe:transition ${
              selected
                ? "surface-raised font-semibold text-primary"
                : "font-medium text-muted hover:text-primary"
            }`}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
