/**
 * Vitest Global Setup
 *
 * This file runs before all tests to initialize shared resources.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isKmsAvailable } from './kms-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Provision a freshly-migrated, isolated SQLite database for the test run so the
 * suite works from a clean checkout without a manual `db:migrate` step. Starting
 * from an empty DB each run keeps results deterministic.
 */
function provisionTestDatabase(): void {
  const dbPath = process.env.DATABASE_PATH ?? resolve(__dirname, '../../data/test.db');
  process.env.DATABASE_PATH = dbPath;
  mkdirSync(dirname(dbPath), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(dbPath + suffix, { force: true });
  }
  const sqlite = new Database(dbPath);
  try {
    migrate(drizzle(sqlite), { migrationsFolder: resolve(__dirname, '../db/migrations') });
  } finally {
    sqlite.close();
  }
}

/**
 * Global setup - runs once before all test files
 */
export async function setup() {
  // Provision the isolated, migrated test database (see provisionTestDatabase).
  provisionTestDatabase();

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
