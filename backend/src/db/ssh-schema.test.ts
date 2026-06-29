/**
 * SSH-05..09 schema validation — runs the 0004 migration against a throwaway
 * in-memory SQLite and asserts the load-bearing constraints: rotation partial
 * unique indexes, per-CA serial uniqueness, FK cascade/restrict, JSON round-trip.
 */
import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(join(here, "migrations/0004_ssh_certificate_manager.sql"), "utf8");

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const stmt of migrationSql.split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) db.exec(s);
  }
  return db;
}

const uuid = (() => {
  let n = 0;
  return () => `id-${++n}`;
})();

function makeCa(db: Database.Database, caType: "user" | "host", status = "active"): string {
  const id = uuid();
  db.prepare(
    `INSERT INTO ssh_cas (id, ca_type, kms_key_id, kms_public_key_id, openssh_public_key, fingerprint_sha256, status)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, caType, "k", "k_pk", "ecdsa-sha2-nistp256 AAAA", "SHA256:x", status);
  return id;
}

describe("SSH schema (0004 migration)", () => {
  let db: Database.Database;
  beforeAll(() => {
    db = freshDb();
  });

  it("creates all 9 ssh_* tables", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ssh_%'")
      .all()
      .map((r: any) => r.name);
    expect(tables).toHaveLength(9);
  });

  it("enforces one active + one rotating CA per type (partial unique indexes)", () => {
    const d = freshDb();
    makeCa(d, "user", "active");
    expect(() => makeCa(d, "user", "active")).toThrow(); // second active user CA rejected
    makeCa(d, "user", "rotating"); // one rotating alongside is allowed
    makeCa(d, "host", "active"); // a host CA is independent
    expect(() => makeCa(d, "host", "active")).toThrow();
  });

  it("enforces (ca_id, serial) uniqueness, not global serial uniqueness", () => {
    const d = freshDb();
    const caA = makeCa(d, "user");
    const caB = makeCa(d, "host");
    const insertCert = (id: string, caId: string, serial: string) =>
      d.prepare(
        `INSERT INTO ssh_certificates (id, ca_id, cert_type, serial, key_id, principals, valid_after, valid_before, cert_openssh, subject_pubkey_fingerprint, kms_signing_key_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).run(id, caId, caId === caA ? "user" : "host", serial, "kid", '["x"]', 1, 2, "cert", "SHA256:y", "k");
    insertCert(uuid(), caA, "1");
    insertCert(uuid(), caB, "1"); // same serial, different CA -> OK
    expect(() => insertCert(uuid(), caA, "1")).toThrow(); // dup serial within CA -> rejected
  });

  it("cascades identity->user_principals and restricts deleting an in-use principal", () => {
    const d = freshDb();
    const identId = uuid();
    d.prepare(`INSERT INTO ssh_identities (id, subject) VALUES (?,?)`).run(identId, "jane");
    const princId = uuid();
    d.prepare(`INSERT INTO ssh_principals (id, name) VALUES (?,?)`).run(princId, "admin");
    d.prepare(`INSERT INTO ssh_user_principals (id, identity_id, principal_id) VALUES (?,?,?)`).run(uuid(), identId, princId);

    // deleting the in-use principal is restricted
    expect(() => d.prepare(`DELETE FROM ssh_principals WHERE id=?`).run(princId)).toThrow();

    // deleting the identity cascades its user_principals
    d.prepare(`DELETE FROM ssh_identities WHERE id=?`).run(identId);
    const remaining = d.prepare(`SELECT COUNT(*) c FROM ssh_user_principals`).get() as any;
    expect(remaining.c).toBe(0);
  });

  it("stores a binary KRL blob + detached signature and round-trips JSON columns", () => {
    const d = freshDb();
    const caId = makeCa(d, "host");
    const blob = Buffer.from([0x53, 0x53, 0x48, 0x4b, 0x52, 0x4c, 0x00, 0x00]); // "SSHKRL\0\0"
    const sig = Buffer.from([0x30, 0x45, 0x02]);
    d.prepare(
      `INSERT INTO ssh_krls (id, ca_id, krl_number, version_hash, krl_blob, ca_signature, this_update, next_update, revoked_count)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(uuid(), caId, 1, "sha256:abc", blob, sig, 1, 2, 3);
    const row = d.prepare(`SELECT krl_blob, ca_signature FROM ssh_krls`).get() as any;
    expect(Buffer.from(row.krl_blob)).toEqual(blob);
    expect(Buffer.from(row.ca_signature)).toEqual(sig);

    // JSON columns are plain text we parse in the service layer.
    const hostId = uuid();
    d.prepare(`INSERT INTO ssh_hosts (id, fqdn, addresses) VALUES (?,?,?)`).run(hostId, "h.lab", JSON.stringify(["h.lab", "10.0.0.1"]));
    const h = d.prepare(`SELECT addresses FROM ssh_hosts WHERE id=?`).get(hostId) as any;
    expect(JSON.parse(h.addresses)).toEqual(["h.lab", "10.0.0.1"]);
  });
});
