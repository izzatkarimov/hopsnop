import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit and component tests. They run in jsdom and never reach a real
// backend: every request goes to the fetch mock in test/api.ts.
export default defineConfig({
  resolve: {
    // The "@/..." imports of tsconfig.json.
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }],
  },
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
    env: {
      // Read by lib/api.ts. Nothing listens there.
      NEXT_PUBLIC_API_URL: "http://api.test",
    },
    // No test sees another's calls or spies, whatever order they run in.
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
