import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same JSX runtime as Next.js, so component modules can be rendered in tests.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" throws outside the React server runtime; route handlers are tested directly in Node.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: process.env.LIVE ? [] : ["tests/live/**"],
    testTimeout: 20_000,
    env: { SPAK_PGLITE_DIR: "memory://", SPAK_APP_ORIGIN: "http://localhost:3000" },
  },
});
