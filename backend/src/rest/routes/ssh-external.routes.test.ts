/**
 * BLK-01 (TASK-178, pinned req #5) — contract tests for the ECIES KRL fetch
 * telemetry stamping: a 304 conditional response must refresh last_krl_fetch_at
 * (a 304 IS a successful pull) while last_krl_version stays 200-only. No KMS:
 * the CA/host/KRL rows are seeded directly and the 304 path never encrypts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { registerSshExternalRoutes } from './ssh-external.routes.js';
import { db } from '../../db/client.js';
import { sshCas, sshHosts, sshCertificates, sshKrls, sshRevocations, sshFleetTokens, sshIdempotency } from '../../db/schema.js';
import { buildKrl, krlVersion } from '../../crypto/ssh/krl.js';
import { getSshMonService } from '../../services/ssh-mon.service.js';

const ctx = { db, ipAddress: null };
const FQDN = 'stamp304.lab.local';

async function wipe() {
  for (const t of [sshIdempotency, sshFleetTokens, sshKrls, sshRevocations, sshCertificates, sshHosts, sshCas]) {
    await db.delete(t);
  }
}

describe('BLK-01 ECIES KRL fetch stamping (contract)', () => {
  let app: FastifyInstance;
  let work: string;
  let hostId: string;
  let version: string;

  async function hostRow() {
    return (await db.select().from(sshHosts).where(eq(sshHosts.id, hostId)).limit(1))[0] as any;
  }

  beforeAll(async () => {
    process.env.SSH_ECIES_ENABLED = 'true';
    work = mkdtempSync(join(tmpdir(), 'ssh-304-'));
    await wipe();
    app = Fastify();
    registerSshExternalRoutes(app);
    await app.ready();

    // Real P-256 host key so the 200 branch can ECIES-encrypt; no KMS anywhere.
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'h'), '-N', '', '-q']);
    const hostPubkey = readFileSync(join(work, 'h.pub'), 'utf8').trim();

    const caId = randomUUID();
    await db.insert(sshCas).values({
      id: caId,
      caType: 'host',
      kmsKeyId: 'test-kms-key',
      kmsPublicKeyId: 'test-kms-pub',
      opensshPublicKey: hostPubkey,
      fingerprintSha256: 'SHA256:contract-test',
      status: 'active',
    } as any);

    hostId = randomUUID();
    await db.insert(sshHosts).values({
      id: hostId,
      fqdn: FQDN,
      opensshHostPubkey: hostPubkey,
      hostKeyAlgorithm: 'ecdsa-sha2-nistp256',
      status: 'active',
    } as any);

    // Fresh KRL row (nextUpdate in the future) so the route serves without regenerating.
    const blob = buildKrl({ krlVersionNumber: 1n, generatedDate: BigInt(Math.floor(Date.now() / 1000)) });
    version = krlVersion(blob);
    await db.insert(sshKrls).values({
      id: randomUUID(),
      caId,
      krlNumber: 1,
      versionHash: version,
      krlBlob: blob,
      caSignature: null,
      thisUpdate: new Date(),
      nextUpdate: new Date(Date.now() + 3600_000),
      revokedCount: 0,
    } as any);
  });

  afterAll(async () => {
    await app?.close();
    await wipe();
    delete process.env.SSH_ECIES_ENABLED;
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('stamps last_krl_fetch_at AND last_krl_version on 200 (unchanged behavior)', async () => {
    await db.update(sshHosts).set({ lastKrlFetchAt: null, lastKrlVersion: null } as any).where(eq(sshHosts.id, hostId));
    const res = await app.inject({ method: 'POST', url: '/api/v1/external/ssh/krl', payload: { host_id: FQDN } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-krl-version']).toBe(version);
    const h = await hostRow();
    expect(h.lastKrlVersion).toBe(version);
    expect(new Date(h.lastKrlFetchAt).getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  it('stamps last_krl_fetch_at on 304 without touching last_krl_version', async () => {
    const staleTime = new Date(Date.now() - 3 * 3600_000);
    await db.update(sshHosts).set({ lastKrlFetchAt: staleTime, lastKrlVersion: version } as any).where(eq(sshHosts.id, hostId));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/external/ssh/krl',
      headers: { 'if-none-match': version },
      payload: { host_id: FQDN },
    });
    expect(res.statusCode).toBe(304);
    const h = await hostRow();
    expect(new Date(h.lastKrlFetchAt).getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect(h.lastKrlVersion).toBe(version);
  });

  it('a 304 on a stale-but-unchanged version refreshes fetch time only', async () => {
    // Host previously saw an OLDER version (e.g. installed via the public path);
    // the conditional pull misses -> 200 restamps both. Conversely a matching
    // If-None-Match must NOT rewrite last_krl_version (order-independence guard).
    await db.update(sshHosts).set({ lastKrlFetchAt: null, lastKrlVersion: 'sha256:older' } as any).where(eq(sshHosts.id, hostId));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/external/ssh/krl',
      headers: { 'if-none-match': version },
      payload: { host_id: FQDN },
    });
    expect(res.statusCode).toBe(304);
    const h = await hostRow();
    expect(h.lastKrlVersion).toBe('sha256:older'); // 304 never rewrites the served-version marker
    expect(h.lastKrlFetchAt).not.toBeNull();
  });

  it('a healthy 304-only puller is no longer flagged by stalePullingHosts', async () => {
    // Simulate a puller whose last unconditional fetch is ancient but that 304s
    // every 15 minutes: before BLK-01 this host read as stale between hourly regens.
    await db.update(sshHosts).set({ lastKrlFetchAt: new Date(Date.now() - 3 * 3600_000) } as any).where(eq(sshHosts.id, hostId));
    const before = await getSshMonService().metrics(ctx);
    expect(before.stalePullingHosts).toBe(1);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/external/ssh/krl',
      headers: { 'if-none-match': version },
      payload: { host_id: FQDN },
    });
    expect(res.statusCode).toBe(304);

    const after = await getSshMonService().metrics(ctx);
    expect(after.stalePullingHosts).toBe(0);
  });
});
