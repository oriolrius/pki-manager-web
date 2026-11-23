/**
 * TASK-246 — migration 0012 backfill. Applies 0000..0011 to a scratch DB, seeds
 * hosts in the pre-0012 shape (seconds timestamps), then applies 0012 and
 * checks: push times become milliseconds, and only "mapped but never pushed"
 * hosts come out Stale (a renewal-bumped updated_at must NOT flag a host).
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
const work = mkdtempSync(join(tmpdir(), 'mig-0012-'));

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('migration 0012 (principals_changed_at backfill)', () => {
  it('converts push times to ms and flags only mapped, never-pushed hosts', () => {
    // A copy of the migrations folder whose journal stops at 0011.
    const pre = join(work, 'pre');
    cpSync(MIGRATIONS, pre, { recursive: true });
    const journalPath = join(pre, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    journal.entries = journal.entries.filter((e: any) => e.idx <= 11);
    writeFileSync(journalPath, JSON.stringify(journal));

    const sqlite = new Database(join(work, 'db.sqlite'));
    try {
      migrate(drizzle(sqlite), { migrationsFolder: pre });
      const cols = (sqlite.prepare(`PRAGMA table_info(ssh_hosts)`).all() as any[]).map((c) => c.name);
      expect(cols).not.toContain('principals_changed_at');

      const pushedSec = 1_790_000_000;
      const updatedSec = pushedSec + 86_400; // e.g. a host cert renewal after the push
      const ins = sqlite.prepare(
        `INSERT INTO ssh_hosts (id, fqdn, status, last_principal_push_at, updated_at) VALUES (?, ?, 'active', ?, ?)`
      );
      ins.run('pushed', 'pushed.lab', pushedSec, updatedSec);
      ins.run('never', 'never.lab', null, updatedSec);
      ins.run('empty', 'empty.lab', null, updatedSec);
      sqlite.prepare(`INSERT INTO ssh_principals (id, name) VALUES ('p', 'ops')`).run();
      const map = sqlite.prepare(`INSERT INTO ssh_host_principal_maps (id, host_id, principal_id, local_account) VALUES (?, ?, 'p', 'root')`);
      map.run('m1', 'pushed');
      map.run('m2', 'never');

      migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS });

      const row = (id: string) =>
        sqlite.prepare(`SELECT last_principal_push_at AS push, principals_changed_at AS changed FROM ssh_hosts WHERE id = ?`).get(id) as any;
      const stale = (r: any) => (r.changed ?? 0) > (r.push ?? 0);

      expect(row('pushed')).toEqual({ push: pushedSec * 1000, changed: null });
      expect(stale(row('pushed'))).toBe(false);
      expect(row('never')).toEqual({ push: null, changed: updatedSec * 1000 });
      expect(stale(row('never'))).toBe(true);
      expect(row('empty')).toEqual({ push: null, changed: null });
      expect(stale(row('empty'))).toBe(false);
    } finally {
      sqlite.close();
    }
  });
});
