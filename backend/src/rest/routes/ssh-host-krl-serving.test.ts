/**
 * BLK-06 (TASK-183) — serving cutover contract tests. The ECIES endpoint's
 * payload source switches to the freshest ssh_host_krls row: first-fetch
 * generates synchronously (globally-seeded number), generation failure returns
 * NO_KRL (NO per-CA fallback — doc-008 finding #4), post-first-row failure
 * serves last-good. SSH_HOST_KRL_SERVE=false rolls back to the per-CA payload;
 * SSH_HOST_KRL_PUBLIC gates the public per-host endpoints (default OFF).
 * KMS signRaw mocked; ECIES encryption is local (no KMS).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { registerSshExternalRoutes } from './ssh-external.routes.js';
import { registerSshPublicRoutes } from './ssh-public.routes.js';
import { db } from '../../db/client.js';
import { auditLog, sshCas, sshCertificates, sshRevocations, sshHosts, sshIdentities, sshHostBlocks, sshHostKrls, sshKrls } from '../../db/schema.js';
import { eciesDecryptV1 } from '../../crypto/ssh/ecies.js';
import { decodeKrl } from '../../test/krl-decode.js';
import { getSshKrlService } from '../../services/ssh-krl.service.js';

const { signRawMock } = vi.hoisted(() => ({
  signRawMock: vi.fn(async () => Buffer.from('detached-der-signature')),
}));
vi.mock('../../kms/service.js', () => ({
  getKMSService: () => ({ signRaw: signRawMock }),
}));

const FQDN = 'cutover.lab.local';
const URL_KRL = '/api/v1/external/ssh/krl';

async function wipe() {
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshCertificates, sshHosts, sshIdentities, sshCas]) {
    await db.delete(t);
  }
  await db.delete(auditLog).where(eq(auditLog.operation, 'ssh.host_krl.generate'));
}

describe('BLK-06 serving cutover', () => {
  let app: FastifyInstance;
  let work: string;
  let hostId: string;
  let caHostId: string;
  let hostKeyPem: string;

  const fetchKrl = (headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: URL_KRL, headers, payload: { host_id: FQDN } });

  const decrypt = (raw: Buffer) => JSON.parse(eciesDecryptV1(createPrivateKey(hostKeyPem), raw).toString('utf8'));

  beforeAll(async () => {
    process.env.SSH_ECIES_ENABLED = 'true';
    delete process.env.SSH_HOST_KRL_SERVE; // default ON
    process.env.SSH_HOST_KRL_PUBLIC = 'false';
    work = mkdtempSync(join(tmpdir(), 'blk06-'));
    await wipe();
    app = Fastify();
    registerSshExternalRoutes(app);
    registerSshPublicRoutes(app);
    await app.ready();

    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-m', 'PEM', '-f', join(work, 'h'), '-N', '', '-q']);
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'caH'), '-N', '', '-q']);
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'ed'), '-N', '', '-q']);
    hostKeyPem = readFileSync(join(work, 'h'), 'utf8');

    caHostId = randomUUID();
    await db.insert(sshCas).values({
      id: caHostId,
      caType: 'host',
      kmsKeyId: 'k-h',
      kmsPublicKeyId: 'kp-h',
      opensshPublicKey: readFileSync(join(work, 'caH.pub'), 'utf8').trim(),
      fingerprintSha256: 'SHA256:h',
      status: 'active',
    } as any);
    hostId = randomUUID();
    await db.insert(sshHosts).values({
      id: hostId,
      fqdn: FQDN,
      opensshHostPubkey: readFileSync(join(work, 'h.pub'), 'utf8').trim(),
      hostKeyAlgorithm: 'ecdsa-sha2-nistp256',
      status: 'active',
    } as any);
    await db.insert(sshHosts).values({
      id: randomUUID(),
      fqdn: 'ed.lab.local',
      opensshHostPubkey: readFileSync(join(work, 'ed.pub'), 'utf8').trim(),
      hostKeyAlgorithm: 'ssh-ed25519',
      status: 'active',
    } as any);
  });

  afterAll(async () => {
    await app?.close();
    await wipe();
    delete process.env.SSH_ECIES_ENABLED;
    delete process.env.SSH_HOST_KRL_SERVE;
    delete process.env.SSH_HOST_KRL_PUBLIC;
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('first fetch with empty ssh_host_krls synchronously generates and serves a seeded per-host row', async () => {
    // Give the per-CA lineage a high number first: the first per-host number
    // MUST exceed it (pinned req #4 — cutover accept).
    const perCa = await getSshKrlService().generate({ db, ipAddress: null }, caHostId);

    expect(await db.select().from(sshHostKrls)).toHaveLength(0);
    const res = await fetchKrl();
    expect(res.statusCode).toBe(200);
    const rows = await db.select().from(sshHostKrls).where(eq(sshHostKrls.hostId, hostId));
    expect(rows).toHaveLength(1);

    const payload = decrypt(Buffer.from(res.rawPayload));
    // Envelope byte-compatible: same field set as the per-CA payload.
    expect(Object.keys(payload).sort()).toEqual(['ca_signature', 'host_id', 'krl', 'krl_version', 'valid_until']);
    expect(payload.host_id).toBe(FQDN);
    expect(payload.krl_version).toBe(res.headers['x-krl-version']);
    expect(payload.valid_until).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const decoded = decodeKrl(Buffer.from(payload.krl, 'base64'));
    expect(decoded.headerNumber).toBeGreaterThan(BigInt(perCa.krlNumber));
  });

  it('304 + telemetry stamping semantics unchanged on the per-host path', async () => {
    const first = await fetchKrl();
    const version = first.headers['x-krl-version'] as string;
    await db.update(sshHosts).set({ lastKrlFetchAt: new Date(Date.now() - 3 * 3600_000) } as any).where(eq(sshHosts.id, hostId));
    const second = await fetchKrl({ 'if-none-match': version });
    expect(second.statusCode).toBe(304);
    const h = (await db.select().from(sshHosts).where(eq(sshHosts.id, hostId)))[0] as any;
    expect(new Date(h.lastKrlFetchAt).getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect(h.lastKrlVersion).toBe(version); // stamped by the earlier 200
  });

  it('post-first-row generation failure serves last-good per-host', async () => {
    // Make the latest row stale, then break generation (unknown signing CA is
    // not enough — kill ALL CAs so resolveHostCa throws).
    await db.update(sshHostKrls).set({ nextUpdate: new Date(Date.now() - 1000) }).where(eq(sshHostKrls.hostId, hostId));
    const cas = await db.select().from(sshCas);
    await db.delete(sshCas);
    try {
      const res = await fetchKrl();
      expect(res.statusCode).toBe(200); // last-good
      const payload = decrypt(Buffer.from(res.rawPayload));
      expect(payload.host_id).toBe(FQDN);
    } finally {
      await db.insert(sshCas).values(cas as any);
    }
  });

  it('first-fetch generation failure returns NO_KRL — no per-CA fallback', async () => {
    await db.delete(sshHostKrls); // simulate cutover: no per-host rows
    const cas = await db.select().from(sshCas);
    await db.delete(sshCas); // generation cannot resolve a host CA
    try {
      const res = await fetchKrl();
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error.code).toBe('NO_KRL');
    } finally {
      await db.insert(sshCas).values(cas as any);
    }
  });

  it('SSH_HOST_KRL_SERVE=false serves the legacy per-CA payload', async () => {
    process.env.SSH_HOST_KRL_SERVE = 'false';
    try {
      // Deleting the CAs in the previous test cascaded the per-CA rows away;
      // regenerate one so the legacy branch has something fresh to serve.
      await getSshKrlService().generate({ db, ipAddress: null }, caHostId);
      const perCaRow = await getSshKrlService().getLatestRow({ db, ipAddress: null }, caHostId);
      const res = await fetchKrl();
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-krl-version']).toBe(perCaRow.versionHash);
    } finally {
      delete process.env.SSH_HOST_KRL_SERVE;
    }
  });

  it('offboarded hosts get 404 — no frozen last-good serving with fresh valid_until', async () => {
    await db.update(sshHosts).set({ status: 'offboarded' } as any).where(eq(sshHosts.id, hostId));
    try {
      const res = await fetchKrl();
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.message).toMatch(/offboarded/);
    } finally {
      await db.update(sshHosts).set({ status: 'active' } as any).where(eq(sshHosts.id, hostId));
    }
  });

  it('ed25519-only hosts keep the ECIES_KEY_UNSUPPORTED path', async () => {
    const res = await app.inject({ method: 'POST', url: URL_KRL, payload: { host_id: 'ed.lab.local' } });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('ECIES_KEY_UNSUPPORTED');
    // Unregistered host unchanged too.
    const missing = await app.inject({ method: 'POST', url: URL_KRL, payload: { host_id: 'nope.lab.local' } });
    expect(missing.statusCode).toBe(404);
  });

  it('public per-host endpoints are OFF by default and gain ETag/304/last-good parity when enabled', async () => {
    // default OFF (both .bin and .json)
    expect((await app.inject({ method: 'GET', url: `/krl/hosts/${FQDN}.bin` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/krl/hosts/${FQDN}.json` })).statusCode).toBe(404);

    process.env.SSH_HOST_KRL_PUBLIC = 'true';
    try {
      const bin = await app.inject({ method: 'GET', url: `/krl/hosts/${FQDN}.bin` });
      expect(bin.statusCode).toBe(200);
      const etag = bin.headers['etag'] as string;
      expect(etag).toMatch(/^sha256:/);
      expect(bin.headers['x-krl-version']).toBe(etag);
      expect(bin.headers['cache-control']).toMatch(/max-age=/);

      const cond = await app.inject({ method: 'GET', url: `/krl/hosts/${FQDN}.bin`, headers: { 'if-none-match': etag } });
      expect(cond.statusCode).toBe(304);

      const json = await app.inject({ method: 'GET', url: `/krl/hosts/${FQDN}.json` });
      expect(json.statusCode).toBe(200);
      const body = JSON.parse(json.body);
      expect(body.krl_version).toBe(etag);
      expect(Buffer.from(body.krl_b64, 'base64').subarray(0, 6).toString()).toBe('SSHKRL');

      // Also resolvable by host id, and 404 on unknown.
      expect((await app.inject({ method: 'GET', url: `/krl/hosts/${hostId}.bin` })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/krl/hosts/unknown.lab.bin' })).statusCode).toBe(404);
    } finally {
      process.env.SSH_HOST_KRL_PUBLIC = 'false';
    }
  });
});
