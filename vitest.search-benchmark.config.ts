import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./ui/src', import.meta.url)),
    },
  },
  test: {
    include: ['benchmark/search-performance.benchmark.ts'],
    maxWorkers: 1,
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 30_000,
  },
});
