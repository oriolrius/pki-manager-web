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
  for (const file of ['0004_ssh_certificate_manager.sql', '0005_ssh_fleet_tokens.sql']) {
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
});
