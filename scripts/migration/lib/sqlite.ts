/**
 * SQLite access with node:sqlite (Node >= 22.16). The source database is only
 * ever opened read-only; writes go to a separate target copy.
 */
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { MigrationError, sha256Hex } from './util.ts';

export type Row = Record<string, unknown>;

export function openReadOnly(path: string): DatabaseSync {
  if (!existsSync(path)) throw new MigrationError('DB_NOT_FOUND', `database not found: ${path}`);
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec('PRAGMA query_only = ON');
  return db;
}

export function openWritable(path: string): DatabaseSync {
  if (!existsSync(path)) throw new MigrationError('DB_NOT_FOUND', `database not found: ${path}`);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
  return db;
}

export function tableExists(db: DatabaseSync, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) !== undefined;
}

export function columnsOf(db: DatabaseSync, table: string): Set<string> {
  if (!tableExists(db, table)) return new Set();
  // PRAGMA table_info does not accept bound parameters; the name is checked above.
  return new Set((db.prepare(`PRAGMA table_info("${table.replace(/"/g, '')}")`).all() as Row[]).map(r => String(r.name)));
}

export function all(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

export function integrityOk(db: DatabaseSync): boolean {
  const rows = all(db, 'PRAGMA integrity_check');
  const fk = all(db, 'PRAGMA foreign_key_check');
  return rows.length === 1 && rows[0].integrity_check === 'ok' && fk.length === 0;
}

/** Drizzle migration journal: number of applied migrations and the newest hash. */
export function appliedMigrations(db: DatabaseSync): { count: number; lastCreatedAt: number | null } {
  if (!tableExists(db, '__drizzle_migrations')) return { count: 0, lastCreatedAt: null };
  const r = db.prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM __drizzle_migrations').get() as Row;
  return { count: Number(r.n), lastCreatedAt: r.last === null ? null : Number(r.last) };
}

/**
 * Consistent copy through the SQLite online backup API (includes committed WAL
 * content). The destination must not exist: a backup never overwrites.
 */
export async function backupTo(sourcePath: string, destPath: string): Promise<string> {
  if (existsSync(destPath)) throw new MigrationError('BACKUP_EXISTS', `refusing to overwrite ${destPath}`);
  const src = openReadOnly(sourcePath);
  try {
    await backup(src, destPath);
  } finally {
    src.close();
  }
  const copy = openReadOnly(destPath);
  try {
    if (!integrityOk(copy)) throw new MigrationError('BACKUP_CORRUPT', `integrity or foreign-key check failed on ${destPath}`);
  } finally {
    copy.close();
  }
  return fileSha256(destPath);
}

export function fileSha256(path: string): string {
  if (!statSync(path).isFile()) throw new MigrationError('NOT_A_FILE', path);
  return sha256Hex(readFileSync(path));
}
