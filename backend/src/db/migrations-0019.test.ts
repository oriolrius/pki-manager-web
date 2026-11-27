/**
 * TASK-288 — migration 0019 (CRL change generation, deleted revocations). It is additive and
 * applies to a fresh database, to a database at 0018 that holds publication state, and to a
 * v3.19.1 database (schema 0015). The triggers add 1 to the change generation of a CA on each
 * write that can change its next CRL, and only then.
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
const work = mkdtempSync(join(tmpdir(), 'mig-0019-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function migrationsUpTo(lastIdx: number): string {
  const dir = join(work, `upto-${lastIdx}`);
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal: { entries: { idx: number }[] } = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e) => e.idx <= lastIdx);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

function runMigrations(sqlite: Database.Database, folder: string): void {
  sqlite.pragma('foreign_keys = OFF');
  migrate(drizzle(sqlite), { migrationsFolder: folder });
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  sqlite.pragma('foreign_keys = ON');
}

function seed(sqlite: Database.Database): void {
  sqlite.prepare(
    `INSERT INTO certificate_authorities (id, kms_certificate_id, kms_key_id, subject_dn, serial_number, key_algorithm, not_before, not_after, status)
     VALUES ('ca-1', 'cert-1', 'key-1', 'CN=Old CA,O=T,C=ES', '01', 'RSA-2048', 1700000000, 2000000000, 'active')`
  ).run();
  const cert = sqlite.prepare(
    `INSERT INTO certificates (id, ca_id, subject_dn, serial_number, certificate_type, not_before, not_after, kms_certificate_id, status, revocation_date, revocation_reason)
     VALUES (?, 'ca-1', ?, ?, 'server', 1700000000, 2000000000, ?, ?, ?, ?)`
  );
  cert.run('leaf-active', 'CN=a,O=T,C=ES', '0a', 'kc-a', 'active', null, null);
  cert.run('leaf-revoked', 'CN=b,O=T,C=ES', '0b', 'kc-b', 'revoked', 1700000500, 'key_compromise');
  sqlite.prepare(
    `INSERT INTO crls (id, ca_id, crl_number, this_update, next_update, crl_pem, revoked_count, created_at) VALUES ('crl-1', 'ca-1', 1, 1700000000, 1700600000, 'pem', 1, 1700000000)`
  ).run();
}

const generation = (sqlite: Database.Database) =>
  (sqlite.prepare(`SELECT change_generation AS g FROM crl_publication WHERE ca_id = 'ca-1'`).get() as { g: number }).g;

describe('migration 0019 (CRL change generation)', () => {
  for (const [label, lastIdx] of [['a database at 0018 with publication state', 18], ['a v3.19.1 database (schema 0015)', 15]] as const) {
    it(`applies to ${label}; existing state starts not verified`, () => {
      const sqlite = new Database(join(work, `from-${lastIdx}.sqlite`));
      try {
        runMigrations(sqlite, migrationsUpTo(lastIdx));
        seed(sqlite);
        if (lastIdx === 18) sqlite.prepare(`INSERT INTO crl_publication (ca_id, last_number) VALUES ('ca-1', 1)`).run();
        runMigrations(sqlite, MIGRATIONS);
        if (lastIdx === 15) sqlite.prepare(`INSERT INTO crl_publication (ca_id, last_number) VALUES ('ca-1', 1)`).run();
        expect(sqlite.prepare(`SELECT change_generation, verified_generation, verified_crl_id FROM crl_publication`).get()).toEqual({
          change_generation: 0,
          verified_generation: null,
          verified_crl_id: null,
        });
        expect(sqlite.prepare(`SELECT count(*) AS n FROM crl_deleted_revocations`).get()).toEqual({ n: 0 });
      } finally {
        sqlite.close();
      }
    });
  }

  it('counts every write that can change the next CRL, and no other write', () => {
    const sqlite = new Database(join(work, 'triggers.sqlite'));
    try {
      runMigrations(sqlite, MIGRATIONS);
      seed(sqlite);
      sqlite.prepare(`INSERT INTO crl_publication (ca_id, last_number) VALUES ('ca-1', 1)`).run();
      const step = (sql: string, delta: number) => {
        const before = generation(sqlite);
        sqlite.prepare(sql).run();
        expect({ sql, delta: generation(sqlite) - before }).toEqual({ sql, delta });
      };
      // No effect on the CRL: an active certificate, other columns of a revoked one, a new CRL row.
      step(`UPDATE certificates SET subject_dn = 'CN=x,O=T,C=ES', updated_at = 1 WHERE id = 'leaf-active'`, 0);
      step(`UPDATE certificates SET status = 'expired' WHERE id = 'leaf-active'`, 0);
      step(`UPDATE certificates SET subject_dn = 'CN=y,O=T,C=ES' WHERE id = 'leaf-revoked'`, 0);
      step(`INSERT INTO crls (id, ca_id, crl_number, this_update, next_update, crl_pem, revoked_count) VALUES ('crl-2', 'ca-1', 2, 1, 2, 'pem', 0)`, 0);
      // Effect on the CRL.
      step(`UPDATE certificates SET status = 'revoked', revocation_date = 1700000600 WHERE id = 'leaf-active'`, 1);
      step(`UPDATE certificates SET revocation_reason = 'superseded' WHERE id = 'leaf-revoked'`, 1);
      step(`INSERT INTO certificates (id, ca_id, subject_dn, serial_number, certificate_type, not_before, not_after, kms_certificate_id, status)
            VALUES ('leaf-new', 'ca-1', 'CN=c,O=T,C=ES', '0c', 'server', 1, 2, 'kc-c', 'revoked')`, 1);
      step(`INSERT INTO certificates (id, ca_id, subject_dn, serial_number, certificate_type, not_before, not_after, kms_certificate_id, status)
            VALUES ('leaf-new2', 'ca-1', 'CN=d,O=T,C=ES', '0d', 'server', 1, 2, 'kc-d', 'active')`, 0);
      step(`INSERT INTO crl_deleted_revocations (ca_id, serial_number, revocation_date) VALUES ('ca-1', '0b', 1700000500)`, 1);
      step(`DELETE FROM certificates WHERE id = 'leaf-revoked'`, 1);
      step(`DELETE FROM certificates WHERE id = 'leaf-new2'`, 0);
      step(`INSERT INTO crl_entry_removals (ca_id, serial_number) VALUES ('ca-1', '0c')`, 1);
      step(`DELETE FROM crl_entry_removals WHERE ca_id = 'ca-1'`, 1);
      step(`UPDATE crls SET next_update = 3 WHERE id = 'crl-2'`, 1);
      step(`DELETE FROM crls WHERE id = 'crl-1'`, 1);
      step(`DELETE FROM crl_deleted_revocations WHERE ca_id = 'ca-1'`, 1);
    } finally {
      sqlite.close();
    }
  });

  it('deleting a CA removes its deleted revocations; the triggers do not block the cascade', () => {
    const sqlite = new Database(join(work, 'cascade.sqlite'));
    try {
      runMigrations(sqlite, MIGRATIONS);
      seed(sqlite);
      sqlite.prepare(`INSERT INTO crl_publication (ca_id, last_number) VALUES ('ca-1', 1)`).run();
      sqlite.prepare(`INSERT INTO crl_deleted_revocations (ca_id, serial_number, revocation_date) VALUES ('ca-1', '0e', 1)`).run();
      sqlite.prepare(`DELETE FROM certificates WHERE ca_id = 'ca-1'`).run();
      sqlite.prepare(`DELETE FROM certificate_authorities WHERE id = 'ca-1'`).run();
      for (const t of ['crl_publication', 'crl_deleted_revocations', 'crls']) {
        expect(sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
      }
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
