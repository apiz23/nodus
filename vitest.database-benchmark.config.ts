import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['benchmark/database-rows.benchmark.ts'],
    maxWorkers: 1,
    testTimeout: 15 * 60 * 1000,
  },
});
