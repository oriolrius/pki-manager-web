/**
 * TASK-288 — migration 0018 (CRL publication). It is additive: it must apply to a fresh database,
 * to a used v4 database (schema 0017) and to a v3.19.1 database (schema 0015) that holds CRL rows
 * with the same number and different DER. Those rows stay byte for byte; only new rows are unique.
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
const work = mkdtempSync(join(tmpdir(), 'mig-0018-'));
/** Every migration of the journal (0018 and the later ones) runs. */
const ALL = (JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length;

afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A copy of the migrations folder that stops at `lastIdx`. */
function migrationsUpTo(lastIdx: number): string {
  const dir = join(work, `upto-${lastIdx}`);
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal: { entries: { idx: number }[] } = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e) => e.idx <= lastIdx);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

/** The backend runner: foreign keys off around migrate(), then a check (src/db/migrate.ts). */
function runMigrations(sqlite: Database.Database, folder: string): void {
  sqlite.pragma('foreign_keys = OFF');
  migrate(drizzle(sqlite), { migrationsFolder: folder });
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  sqlite.pragma('foreign_keys = ON');
}

function seedOldData(sqlite: Database.Database): void {
  sqlite.prepare(
    `INSERT INTO certificate_authorities (id, kms_certificate_id, kms_key_id, subject_dn, serial_number, key_algorithm, not_before, not_after, status)
     VALUES ('ca-1', 'cert-1', 'key-1', 'CN=Old CA,O=T,C=ES', '01', 'RSA-2048', 1700000000, 2000000000, 'active')`
  ).run();
  const crl = sqlite.prepare(
    `INSERT INTO crls (id, ca_id, crl_number, this_update, next_update, crl_pem, revoked_count, created_at) VALUES (?, 'ca-1', ?, 1700000000, 1700600000, ?, ?, ?)`
  );
  crl.run('crl-12', 12, '-----BEGIN X509 CRL-----\nMTI=\n-----END X509 CRL-----', 1, 1700000000);
  // Two published CRLs that share number 13 (concurrent generation in v3).
  crl.run('crl-13a', 13, '-----BEGIN X509 CRL-----\nMTNh\n-----END X509 CRL-----', 2, 1700000100);
  crl.run('crl-13b', 13, '-----BEGIN X509 CRL-----\nMTNi\n-----END X509 CRL-----', 2, 1700000101);
  crl.run('crl-empty', 14, '', 0, 1700000200); // issue #48 row
}

const oldRows = (sqlite: Database.Database) =>
  sqlite.prepare(`SELECT id, ca_id, crl_number, this_update, next_update, crl_pem, revoked_count, created_at FROM crls ORDER BY id`).all();

function expectSchema0018(sqlite: Database.Database): void {
  const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => (r as { name: string }).name);
  expect(tables).toEqual(expect.arrayContaining(['crl_publication', 'crl_entry_removals']));
  const columns = sqlite.prepare(`PRAGMA table_info(crls)`).all().map((c) => (c as { name: string }).name);
  expect(columns).toContain('entries_sha256');
  const index = sqlite.prepare(`PRAGMA index_list(crls)`).all().find((i) => (i as { name: string }).name === 'uq_crls_published_number') as
    | { unique: number; partial: number }
    | undefined;
  expect(index).toMatchObject({ unique: 1, partial: 1 });
}

describe('migration 0018 (CRL publication)', () => {
  it('applies to a fresh database', () => {
    const sqlite = new Database(join(work, 'fresh.sqlite'));
    try {
      runMigrations(sqlite, MIGRATIONS);
      expectSchema0018(sqlite);
    } finally {
      sqlite.close();
    }
  });

  for (const [label, lastIdx] of [['a used v4 database (schema 0017)', 17], ['a v3.19.1 database (schema 0015)', 15]] as const) {
    it(`applies to ${label} and keeps its CRL rows, also duplicate numbers`, () => {
      const sqlite = new Database(join(work, `used-${lastIdx}.sqlite`));
      try {
        runMigrations(sqlite, migrationsUpTo(lastIdx));
        seedOldData(sqlite);
        const before = oldRows(sqlite);

        runMigrations(sqlite, MIGRATIONS);
        expectSchema0018(sqlite);
        expect(oldRows(sqlite)).toEqual(before);
        expect(sqlite.prepare(`SELECT count(*) AS n FROM crls WHERE entries_sha256 IS NOT NULL`).get()).toEqual({ n: 0 });
        expect(sqlite.prepare(`SELECT count(*) AS n FROM crl_publication`).get()).toEqual({ n: 0 });
        const applied = sqlite.prepare(`SELECT count(*) AS n FROM __drizzle_migrations`).get() as { n: number };
        expect(applied.n).toBe(ALL);

        // New rows (with a digest) are unique per CA and number; old rows are not touched.
        const insert = sqlite.prepare(
          `INSERT INTO crls (id, ca_id, crl_number, this_update, next_update, crl_pem, revoked_count, entries_sha256) VALUES (?, 'ca-1', ?, 1, 2, 'pem', 0, ?)`
        );
        insert.run('new-15', 15, 'a'.repeat(64));
        expect(() => insert.run('new-15-again', 15, 'b'.repeat(64))).toThrow(/UNIQUE/);
        insert.run('old-style-13', 13, null); // a row without a digest can still repeat a number
        expect(sqlite.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
        // Running the runner again changes nothing.
        runMigrations(sqlite, MIGRATIONS);
        expect((sqlite.prepare(`SELECT count(*) AS n FROM __drizzle_migrations`).get() as { n: number }).n).toBe(ALL);
      } finally {
        sqlite.close();
      }
    });
  }

  it('deleting a CA removes its publication state and removals', () => {
    const sqlite = new Database(join(work, 'cascade.sqlite'));
    try {
      runMigrations(sqlite, MIGRATIONS);
      seedOldData(sqlite);
      sqlite.prepare(`INSERT INTO crl_publication (ca_id, last_number) VALUES ('ca-1', 14)`).run();
      sqlite.prepare(`INSERT INTO crl_entry_removals (ca_id, serial_number) VALUES ('ca-1', '0a')`).run();
      sqlite.prepare(`DELETE FROM certificate_authorities WHERE id = 'ca-1'`).run();
      for (const t of ['crl_publication', 'crl_entry_removals', 'crls']) {
        expect(sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
      }
    } finally {
      sqlite.close();
    }
  });
});
