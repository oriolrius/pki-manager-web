import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Get database path from environment or use default
const dbPath = process.env.DATABASE_PATH || './data/pki.db';

// Ensure data directory exists
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Create SQLite database connection
const sqlite = new Database(dbPath);

// Enable foreign keys
sqlite.pragma('foreign_keys = ON');

// Enable WAL mode for better concurrency
sqlite.pragma('journal_mode = WAL');

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });

// Export the raw SQLite instance for advanced operations
export const sqliteDb: Database.Database = sqlite;

// Helper function to close database connection (for graceful shutdown)
export function closeDatabase() {
  sqlite.close();
}
