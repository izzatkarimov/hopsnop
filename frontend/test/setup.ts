import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { api } from "./api";

beforeEach(() => {
  api.install();
});

afterEach(() => {
  // Unmounted first, while the timers it may have set still belong to it.
  cleanup();
  vi.useRealTimers();
  api.verify();
});
