import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Global setup file for KMS check and other shared resources
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

    // Pool options for better isolation
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },

    // Sequence options - run tests in parallel by default
    sequence: {
      shuffle: false,
    },
  },
});
