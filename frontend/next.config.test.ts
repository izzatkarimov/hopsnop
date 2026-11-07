import { expect, it } from "vitest";
import nextConfig from "./next.config";

it("turns the image optimizer off", () => {
  expect(nextConfig.images?.unoptimized).toBe(true);
});
