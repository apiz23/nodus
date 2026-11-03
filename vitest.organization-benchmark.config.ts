import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['benchmark/organization.benchmark.ts'], maxWorkers: 1, testTimeout: 120_000 } });
