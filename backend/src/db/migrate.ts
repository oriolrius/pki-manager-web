import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqliteDb } from './client.js';

console.log('Running migrations...');

try {
  migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log('Migrations completed successfully!');
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
} finally {
  sqliteDb.close();
}
