import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqliteDb } from './client.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = join(__dirname, 'migrations');

console.log('Running migrations...');
console.log('Migrations folder:', migrationsFolder);

try {
  // SQLite table rebuilds (e.g. 0009 SSH Zones) DROP parent tables referenced by
  // FKs, which would cascade with foreign_keys=ON. `PRAGMA foreign_keys` is a
  // no-op inside drizzle's migration transaction, so the toggle must happen here,
  // before migrate() opens BEGIN. client.ts sets it ON at import; disable it for
  // the DDL run, then re-assert referential integrity before turning it back on.
  sqliteDb.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder });
  const violations = sqliteDb.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`Post-migration foreign_key_check failed: ${JSON.stringify(violations)}`);
  }
  sqliteDb.pragma('foreign_keys = ON');
  console.log('Migrations completed successfully!');
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
} finally {
  sqliteDb.close();
}
