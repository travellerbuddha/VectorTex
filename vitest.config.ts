import { defineConfig } from 'vitest/config';

// unit: pure tests, no network/DB.
// integration: need DATABASE_URL (PostgreSQL) and REDIS_URL; see docs/plan/test-matrix.md.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/*.sandbox.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        // Opt-in provider sandbox evidence runs; never part of CI. See packages/*/test/*.sandbox.test.ts.
        test: {
          name: 'sandbox',
          include: ['packages/*/test/**/*.sandbox.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 400_000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.int.test.ts', 'apps/*/test/**/*.int.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
