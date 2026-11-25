/**
 * Issue #52 — migration 0015. Applies 0000..0014 to a scratch DB, seeds the old
 * key-only idempotency cache, then applies 0015 and checks: the primary key is
 * (token_id, key), two tokens can hold the same key, and the old rows are gone.
 */
import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, 'migrations');
const work = mkdtempSync(join(tmpdir(), 'mig-0015-'));

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('migration 0015 (token-scoped ssh_idempotency)', () => {
  it('rebuilds the cache with a (token_id, key) primary key and drops old rows', () => {
    const pre = join(work, 'pre');
    cpSync(MIGRATIONS, pre, { recursive: true });
    const journalPath = join(pre, 'meta', '_journal.json');
    const journal: { entries: { idx: number }[] } = JSON.parse(readFileSync(journalPath, 'utf8'));
    journal.entries = journal.entries.filter((e) => e.idx <= 14);
    writeFileSync(journalPath, JSON.stringify(journal));

    const sqlite = new Database(join(work, 'db.sqlite'));
    try {
      migrate(drizzle(sqlite), { migrationsFolder: pre });
      sqlite.prepare(`INSERT INTO ssh_idempotency (key, token_id, cert_id, response) VALUES ('k', 'tok-a', 'c', '{}')`).run();

      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS });

      const pk = sqlite.prepare<[], { name: string; pk: number }>(`PRAGMA table_info(ssh_idempotency)`).all()
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      expect(pk).toEqual(['token_id', 'key']);
      expect(sqlite.prepare(`SELECT count(*) AS n FROM ssh_idempotency`).get()).toEqual({ n: 0 });

      const ins = sqlite.prepare(
        `INSERT INTO ssh_idempotency (token_id, key, op, request_hash, response, expires_at) VALUES (?, 'same', 'sign-host', 'h', '{}', 4102444800)`
      );
      ins.run('tok-a');
      ins.run('tok-b');
      expect(() => ins.run('tok-a')).toThrow(/UNIQUE/);
      expect(sqlite.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
