import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));

// Default the suite to an isolated, auto-migrated SQLite DB (provisioned fresh in
// src/test/setup.ts) so `pnpm test` runs from a clean checkout with no manual
// `db:migrate` step. An explicit DATABASE_PATH (e.g. in CI) is respected.
const TEST_DATABASE_PATH = process.env.DATABASE_PATH ?? resolve(rootDir, 'data/test.db');
process.env.DATABASE_PATH = TEST_DATABASE_PATH;

export default defineConfig({
  test: {
    // Point test workers at the isolated DB migrated by globalSetup.
    env: { DATABASE_PATH: TEST_DATABASE_PATH },

    // Global setup file: migrates the test DB + checks KMS availability
    globalSetup: ['./src/test/setup.ts'],

    // Test environment
    environment: 'node',

    // Include test files
    include: ['src/**/*.test.ts'],

    // Exclude patterns
    exclude: ['**/node_modules/**', '**/dist/**'],

    // Test timeout (increased for KMS integration tests)
    testTimeout: 30000,

    // Hook timeout (for beforeAll/afterAll with KMS operations)
    hookTimeout: 60000,

    // Reporter settings
    reporters: ['default'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.ts',
        '**/test/**',
      ],
    },

    // Pool options - use single fork to avoid database race conditions
    // Tests within a file can still run in parallel if they don't share state
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Run test files sequentially to avoid database conflicts between files
    fileParallelism: false,

    // Sequence options - run tests in parallel by default
    sequence: {
      shuffle: false,
    },
  },
});
