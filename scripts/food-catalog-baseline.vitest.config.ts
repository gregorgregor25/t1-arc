import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/food-catalog-baseline.test.ts'],
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 5 * 60 * 1_000,
  },
});
