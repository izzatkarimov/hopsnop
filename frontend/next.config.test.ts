import { expect, it } from "vitest";
import nextConfig from "./next.config";

it("turns the image optimizer off", () => {
  expect(nextConfig.images?.unoptimized).toBe(true);
});

it("builds a standalone server for the container", () => {
  expect(nextConfig.output).toBe("standalone");
});

it("leaves sharp and libvips out of the standalone server", () => {
  expect(nextConfig.outputFileTracingExcludes?.["*"]).toEqual(
    expect.arrayContaining(["**/node_modules/sharp/**", "**/node_modules/@img/**"]),
  );
});
