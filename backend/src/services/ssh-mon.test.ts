import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as schema from '../db/schema.js';
import { getSshMonService } from './ssh-mon.service.js';
import { rateLimitOk, resetRateLimits } from '../rest/middleware/ssh-rate-limit.js';

const here = dirname(fileURLToPath(import.meta.url));
const mig = (f: string) => readFileSync(join(here, '../db/migrations', f), 'utf8');

function freshDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of ['0006_ssh_certificate_manager.sql', '0007_ssh_fleet_tokens.sql', '0008_ssh_host_blocks.sql', '0009_stiff_wallflower.sql']) {
    for (const stmt of mig(file).split('--> statement-breakpoint')) {
      const s = stmt.trim();
      if (s) sqlite.exec(s);
    }
  }
  return drizzle(sqlite, { schema });
}

describe('rateLimitOk (SSH-MON abuse control)', () => {
  it('allows up to the limit then blocks within the window', () => {
    resetRateLimits();
    const key = 'unit-test-ip';
    let allowed = 0;
    for (let i = 0; i < 5; i++) if (rateLimitOk(key, 3, 60_000)) allowed++;
    expect(allowed).toBe(3); // 4th and 5th blocked
    expect(rateLimitOk('other-ip', 3, 60_000)).toBe(true); // independent key
  });
});

describe('SshMonService.metrics', () => {
  it('counts expiring certs, CAs without a KRL, and is machine-readable', async () => {
    const db = freshDb();
    const ctx = { db, ipAddress: null };
    db.insert(schema.sshCas)
      .values({ id: 'ca1', caType: 'host', kmsKeyId: 'k', kmsPublicKeyId: 'k_pk', opensshPublicKey: 'ecdsa-sha2-nistp256 AAAA', fingerprintSha256: 'SHA256:x', status: 'active' } as any)
      .run();
    // an active cert expiring in 1 day (within the default 1w window)
    db.insert(schema.sshCertificates)
      .values({ id: 'c1', caId: 'ca1', certType: 'host', serial: '1', keyId: 'h', principals: '["h"]', validAfter: new Date(), validBefore: new Date(Date.now() + 24 * 3600 * 1000), certOpenssh: 'cert', subjectPubkeyFingerprint: 'SHA256:y', kmsSigningKeyId: 'k', status: 'active' } as any)
      .run();

    const m = await getSshMonService().metrics(ctx);
    expect(m.expiringSoon).toBe(1);
    expect(m.casWithoutKrl).toBe(1);
    expect(m.krlsPastNextUpdate).toBe(0);
    expect(typeof m.stalePullingHosts).toBe('number');
    expect(m.generatedAt).toMatch(/^\d{4}-/);
  });

  it('BLK-07: exposes per-host lineage metrics beside the per-CA ones', async () => {
    const db = freshDb();
    const ctx = { db, ipAddress: null };
    const host = (id: string) =>
      db.insert(schema.sshHosts).values({ id, fqdn: `${id}.lab`, status: 'active' } as any).run();
    host('h-none'); // no per-host row -> hostsWithoutHostKrl
    host('h-stale'); // latest row past nextUpdate -> hostKrlsPastNextUpdate
    host('h-fresh'); // fresh row -> neither
    db.insert(schema.sshHosts).values({ id: 'h-off', fqdn: 'off.lab', status: 'offboarded' } as any).run(); // ignored

    const krl = (id: string, hostId: string, n: number, nextUpdate: Date) =>
      db.insert(schema.sshHostKrls).values({
        id, hostId, krlNumber: n, versionHash: `sha256:${id}`, krlBlob: Buffer.from('krl'),
        thisUpdate: new Date(Date.now() - 3600_000), nextUpdate,
      } as any).run();
    krl('k1', 'h-stale', 1, new Date(Date.now() - 60_000));
    krl('k2', 'h-fresh', 2, new Date(Date.now() + 3600_000));
    // Superseded stale row on the fresh host must NOT count — only the latest matters.
    krl('k3', 'h-fresh', 1, new Date(Date.now() - 60_000));

    const m = await getSshMonService().metrics(ctx);
    expect(m.hostsWithoutHostKrl).toBe(1); // h-none only (offboarded ignored)
    expect(m.hostKrlsPastNextUpdate).toBe(1); // h-stale only
  });
});
