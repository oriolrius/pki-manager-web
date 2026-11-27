/**
 * The frozen source: the v3 database copy that inventory, apply and verify
 * all read. The manifest binds it in two ways:
 *
 * - `dbSha256`: SHA-256 of the main database file;
 * - `contentSha256`: SHA-256 of the logical content read THROUGH SQLite
 *   (schema, every row of every table, user_version), so the content of a
 *   write-ahead log is part of it.
 *
 * A source with commits still in its `-wal` file, or with a rollback journal,
 * is not frozen: its main file does not hold all its data, and a writer may
 * still be attached. Such a source is refused; `pki-migrate backup` makes a
 * frozen copy with the SQLite online backup API.
 */
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { fileSha256 } from './sqlite.ts';
import { MigrationError } from './util.ts';

export const CONTENT_DIGEST_FORMAT = 'pki-migrate-content/1';

/** Encode SQLite values by type. Whole numeric values compare equal (1 and 1.0). */
export function canonicalValue(v: SQLOutputValue): string {
  if (v === null) return 'n';
  if (typeof v === 'bigint') return `i${v.toString()}`;
  if (typeof v === 'number') return Number.isInteger(v) ? `i${v}` : `r${v}`;
  if (typeof v === 'string') return `s${JSON.stringify(v)}`;
  return `b${Buffer.from(v).toString('hex')}`;
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Column names of a table, in declaration order. */
export function orderedColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map(r => String(r.name));
}

/**
 * Every row of a table as canonical strings, in a deterministic order (all
 * columns). Integers are read as BigInt: no precision is lost.
 */
export function* canonicalRows(db: DatabaseSync, table: string, columns: string[]): Generator<{ values: SQLOutputValue[]; text: string[] }> {
  const order = columns.map((_, i) => i + 1).join(', ');
  const stmt = db.prepare(`SELECT ${columns.map(quote).join(', ')} FROM ${quote(table)}${order ? ` ORDER BY ${order}` : ''}`);
  stmt.setReadBigInts(true);
  for (const row of stmt.iterate() as Iterable<Record<string, SQLOutputValue>>) {
    const values = columns.map(c => row[c]);
    yield { values, text: values.map(canonicalValue) };
  }
}

/** SHA-256 of the logical content: schema objects, all rows of all tables, user_version. */
export function contentDigest(db: DatabaseSync): string {
  const h = createHash('sha256');
  h.update(`${CONTENT_DIGEST_FORMAT}\n`);
  const objects = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all() as { type: string; name: string; tbl_name: string; sql: string | null }[];
  for (const o of objects) h.update(`${JSON.stringify(['schema', o.type, o.name, o.tbl_name, o.sql])}\n`);
  for (const o of objects.filter(x => x.type === 'table')) {
    const cols = orderedColumns(db, o.name);
    h.update(`${JSON.stringify(['table', o.name, cols])}\n`);
    for (const r of canonicalRows(db, o.name, cols)) h.update(`${JSON.stringify(r.text)}\n`);
  }
  const uv = db.prepare('PRAGMA user_version').get() as { user_version: number };
  h.update(`${JSON.stringify(['user_version', Number(uv.user_version)])}\n`);
  return h.digest('hex');
}

/** Why a database file is not a frozen copy (empty list = frozen). */
export function notFrozen(path: string): string[] {
  const out: string[] = [];
  const wal = `${path}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) out.push(`${wal} holds ${statSync(wal).size} bytes: commits may still be in the write-ahead log, or a writer is attached`);
  if (existsSync(`${path}-journal`)) out.push(`${path}-journal exists: an interrupted or running transaction`);
  return out;
}

export function assertFrozen(path: string): void {
  const why = notFrozen(path);
  if (why.length) {
    throw new MigrationError('SOURCE_NOT_FROZEN', `${why.join('; ')}. Stop every writer, then make a frozen copy with "pki-migrate backup --db ${path} --out-dir DIR" and use DIR/pki.db as --source-db`);
  }
}

export interface SourceBinding { dbSha256: string; contentSha256: string }

/** Binding of a frozen source (refuses one that is not frozen). `db` must be open on `path`. */
export function sourceBinding(path: string, db: DatabaseSync): SourceBinding {
  assertFrozen(path);
  return { dbSha256: fileSha256(path), contentSha256: contentDigest(db) };
}

/**
 * Checks a source copy against the binding of the manifest. Returns the
 * problems (empty = same frozen source). Without `path` (a library caller
 * with an open database only) the content digest alone is compared.
 */
export function checkBinding(expected: Partial<SourceBinding>, path: string | undefined, db: DatabaseSync): string[] {
  const bad = path ? notFrozen(path) : [];
  if (!expected.contentSha256) bad.push('the manifest has no content digest (made by an older pki-migrate): run inventory again on the frozen copy');
  const file = path ? fileSha256(path) : null;
  if (file && expected.dbSha256 && file !== expected.dbSha256) bad.push(`file sha256 ${file.slice(0, 16)}... != manifest ${expected.dbSha256.slice(0, 16)}...`);
  if (expected.contentSha256) {
    const content = contentDigest(db);
    if (content !== expected.contentSha256) bad.push(`content sha256 ${content.slice(0, 16)}... != manifest ${expected.contentSha256.slice(0, 16)}... (rows changed since inventory)`);
  }
  return bad;
}
