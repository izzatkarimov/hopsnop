import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { api } from "./api";

// jsdom has no modal dialogs: just enough to open one and close it with "close".
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

beforeEach(() => {
  api.install();
});

afterEach(() => {
  // Unmounted first, while the timers it may have set still belong to it.
  cleanup();
  vi.useRealTimers();
  api.verify();
});
