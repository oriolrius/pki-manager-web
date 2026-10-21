/**
 * ZONE-01 (decision-017) schema constraints. Applies the FULL migration chain
 * (0000..0009) to a throwaway in-memory SQLite and asserts the zone-scoped
 * partial-unique / natural-key indexes and the ON DELETE RESTRICT wiring that
 * make a zone a real trust boundary.
 *
 * Migrations run with foreign_keys OFF (the 0009 rebuild DROPs FK-referenced
 * parents — same reason src/db/migrate.ts toggles it); assertions run with
 * foreign_keys ON.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const s = stmt.trim();
      if (s) db.exec(s);
    }
  }
  db.pragma('foreign_keys = ON');
  return db;
}

let seq = 0;
const uid = () => `id-${++seq}`;

function makeZone(db: Database.Database, name: string): string {
  const id = uid();
  db.prepare(`INSERT INTO zones (id, name, display_name) VALUES (?,?,?)`).run(id, name, name);
  return id;
}
function makeCa(db: Database.Database, zoneId: string, caType: string, status = 'active'): string {
  const id = uid();
  db.prepare(
    `INSERT INTO ssh_cas (id, zone_id, ca_type, kms_key_id, kms_public_key_id, openssh_public_key, fingerprint_sha256, status)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, zoneId, caType, 'k', 'kpk', 'ecdsa-sha2-nistp256 AAAA', 'SHA256:' + id, status);
  return id;
}

describe('ZONE-01 schema (0009 SSH Zones migration)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('seeds exactly one default zone named "default"', () => {
    const rows = db.prepare(`SELECT id, name, status FROM zones`).all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'default', name: 'default', status: 'active' });
  });

  it('AC#1 — two zones can each hold their own active User CA and Host CA at once', () => {
    const prod = makeZone(db, 'prod');
    const staging = makeZone(db, 'staging');
    expect(() => {
      makeCa(db, prod, 'user');
      makeCa(db, prod, 'host');
      makeCa(db, staging, 'user');
      makeCa(db, staging, 'host');
    }).not.toThrow();
    expect((db.prepare(`SELECT count(*) c FROM ssh_cas`).get() as any).c).toBe(4);
  });

  it('AC#2 — a second active CA of the same type within one zone is rejected', () => {
    const prod = makeZone(db, 'prod');
    makeCa(db, prod, 'user', 'active');
    expect(() => makeCa(db, prod, 'user', 'active')).toThrow(/UNIQUE/i);
    // rotating slot is likewise one-per-(zone,type)
    makeCa(db, prod, 'user', 'rotating');
    expect(() => makeCa(db, prod, 'user', 'rotating')).toThrow(/UNIQUE/i);
  });

  it('AC#3 — fqdn / subject / principal-name are unique per zone, reusable across zones', () => {
    const a = makeZone(db, 'a');
    const b = makeZone(db, 'b');
    const insHost = (z: string) =>
      db.prepare(`INSERT INTO ssh_hosts (id, zone_id, fqdn) VALUES (?,?,?)`).run(uid(), z, 'web1.example.com');
    const insId = (z: string) =>
      db.prepare(`INSERT INTO ssh_identities (id, zone_id, subject) VALUES (?,?,?)`).run(uid(), z, 'oriol');
    const insPrin = (z: string) =>
      db.prepare(`INSERT INTO ssh_principals (id, zone_id, name) VALUES (?,?,?)`).run(uid(), z, 'admin');

    expect(() => {
      insHost(a); insHost(b);
      insId(a); insId(b);
      insPrin(a); insPrin(b);
    }).not.toThrow();
    expect(() => insHost(a)).toThrow(/UNIQUE/i);
    expect(() => insId(a)).toThrow(/UNIQUE/i);
    expect(() => insPrin(a)).toThrow(/UNIQUE/i);
  });

  it('AC#5 — a zone that still owns rows cannot be deleted (ON DELETE RESTRICT)', () => {
    const z = makeZone(db, 'owns');
    makeCa(db, z, 'host');
    expect(() => db.prepare(`DELETE FROM zones WHERE id = ?`).run(z)).toThrow(/FOREIGN KEY/i);
    // once the CA is gone, the zone can be removed
    db.prepare(`DELETE FROM ssh_cas WHERE zone_id = ?`).run(z);
    expect(() => db.prepare(`DELETE FROM zones WHERE id = ?`).run(z)).not.toThrow();
  });

  it('an insert that omits zone_id lands in the seeded default zone (column default)', () => {
    // The DEFAULT 'default' backstops raw inserts / a migrated single-zone
    // install; service create-paths always resolve the zone fail-closed and pass
    // it explicitly, so this default is never reached by real code once >1 zone.
    const id = uid();
    db.prepare(`INSERT INTO ssh_principals (id, name) VALUES (?,?)`).run(id, 'x');
    const row = db.prepare(`SELECT zone_id FROM ssh_principals WHERE id = ?`).get(id) as any;
    expect(row.zone_id).toBe('default');
  });

  it('an explicit NULL zone_id is still rejected (NOT NULL)', () => {
    expect(() =>
      db.prepare(`INSERT INTO ssh_principals (id, zone_id, name) VALUES (?,?,?)`).run(uid(), null, 'y')
    ).toThrow(/NOT NULL/i);
  });
});
