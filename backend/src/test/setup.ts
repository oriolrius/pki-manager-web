/**
 * Vitest Global Setup
 *
 * This file runs before all tests to initialize shared resources.
 */

import { isKmsAvailable } from './kms-helper.js';

/**
 * Global setup - runs once before all test files
 */
export async function setup() {
  // Check KMS availability and cache the result
  const kmsAvailable = await isKmsAvailable();

  // Set environment variable for tests to check
  process.env.KMS_AVAILABLE = kmsAvailable ? 'true' : 'false';

  if (!kmsAvailable) {
    console.log('\n');
    console.log('  ┌─────────────────────────────────────────────────────────────────┐');
    console.log('  │                        KMS NOT AVAILABLE                        │');
    console.log('  ├─────────────────────────────────────────────────────────────────┤');
    console.log('  │  KMS integration tests will be SKIPPED.                         │');
    console.log('  │                                                                 │');
    console.log('  │  To run all tests, start KMS first:                             │');
    console.log('  │    cd kms && docker compose up -d                               │');
    console.log('  │                                                                 │');
    console.log('  │  Or use CI mode with: pnpm test:ci                              │');
    console.log('  └─────────────────────────────────────────────────────────────────┘');
    console.log('\n');
  }
}

/**
 * Global teardown - runs once after all test files
 */
export async function teardown() {
  // Cleanup if needed
}
