import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Production follows the device's IANA timezone. Keep the historical UK fixtures
// deterministic when the suite runs on CI machines in other regions.
process.env.TZ = 'Europe/London';

export default defineConfig({
  define: {
    __DEV__: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/testEnvironment.ts'],
    // A handful of integration-style tests intentionally stream large exports
    // or invoke the Android verifier. They can exceed Vitest's five-second
    // default when the full suite runs in parallel on Windows.
    testTimeout: 30_000,
  },
});
