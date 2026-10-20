"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";

export type FeedTab = {
  id: string;
  label: string;
};

type FeedTabsProps = {
  tabs: FeedTab[];
  activeTab: string;
  onChange: (tabId: string) => void;
};

/** Element ids linking each tab to the panel it controls. */
export function feedTabId(tabId: string) {
  return `feed-tab-${tabId}`;
}

export function feedPanelId(tabId: string) {
  return `feed-panel-${tabId}`;
}

/** Accessible tab list (WAI-ARIA tabs pattern with arrow-key navigation). */
export function FeedTabs({ tabs, activeTab, onChange }: FeedTabsProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    onChange(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div role="tablist" aria-label="Feed" onKeyDown={handleKeyDown} className="flex">
      {tabs.map((tab, index) => {
        const selected = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={feedTabId(tab.id)}
            aria-selected={selected}
            // Only the selected tab's panel is rendered.
            aria-controls={selected ? feedPanelId(tab.id) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`flex flex-1 justify-center py-3 text-body transition-colors hover:bg-hover focus-visible:-outline-offset-2 ${
              selected ? "font-semibold" : "text-muted"
            }`}
          >
            <span
              className={`-mb-3 border-b-3 pb-2.5 ${selected ? "border-accent" : "border-transparent"}`}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
