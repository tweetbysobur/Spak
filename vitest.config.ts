import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: process.env.LIVE ? [] : ["tests/live/**"],
    testTimeout: 20_000,
  },
});
