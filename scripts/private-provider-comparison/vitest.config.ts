import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

process.env.TZ = "Europe/London";

// Dedicated config: normal npm test cannot include this file, and this suite
// cannot accidentally run normal tests or parallelise live dispatches.
export default defineConfig({
  define: { __DEV__: false },
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["scripts/private-provider-comparison/comparison.live.ts"],
    setupFiles: ["tests/testEnvironment.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 10 * 60_000,
  },
});
