/**
 * SSH-21/22 — revoke -> build bare KRL + detached signature -> serve publicly
 * (ETag/304/lazy-regen) -> ssh-keygen -Q confirms the cert is revoked by the
 * served bytes. Gated on KMS_AVAILABLE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSshPublicRoutes } from '../rest/routes/ssh-public.routes.js';
import { db } from '../db/client.js';
import { sshCas, sshHosts, sshIdentities, sshCertificates, sshKrls, sshHostKrls, sshHostBlocks, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshPrincipals, sshFleetTokens, sshIdempotency } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { getSshCaService } from './ssh-ca.service.js';
import { getSshHostService } from './ssh-host.service.js';
import { getSshKrlService } from './ssh-krl.service.js';

const KMS = process.env.KMS_AVAILABLE === 'true';
const ctx = { db, ipAddress: null };

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) { try { await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId); } catch { /* */ } }
  for (const t of [sshHostKrls, sshHostBlocks, sshIdempotency, sshFleetTokens, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
}

function isRevoked(krlPath: string, keyPath: string): boolean {
  const r = spawnSync('ssh-keygen', ['-Q', '-f', krlPath, keyPath], { encoding: 'utf8' });
  return r.status !== 0 && /REVOKED/i.test(r.stdout + r.stderr);
}

describe.skipIf(!KMS)('SSH-21/22 KRL service + public serving', () => {
  let app: FastifyInstance;
  let work: string;
  let hostCa: any;
  let hostCertPath: string;
  let certId: string;
  let caId: string;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'ssh-krl-'));
    await wipe();
    app = Fastify();
    registerSshPublicRoutes(app);
    await app.ready();

    await getSshCaService().create(ctx, { caType: 'user' });
    hostCa = await getSshCaService().create(ctx, { caType: 'host' });
    caId = hostCa.id;
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'h'), '-N', '', '-q']);
    const host = await getSshHostService().register(ctx, { fqdn: 'krl.lab.local', addresses: ['10.0.0.8'], opensshHostPubkey: readFileSync(join(work, 'h.pub'), 'utf8') });
    const issued = await getSshHostService().issue(ctx, { hostId: host.id });
    certId = issued.cert.id;
    hostCertPath = join(work, 'h-cert.pub');
    writeFileSync(hostCertPath, issued.cert.certOpenssh);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('builds a signed KRL on revocation that ssh-keygen -Q honours from the served bytes', async () => {
    const before = await getSshKrlService().getLatest(ctx, caId);
    expect(before).toBeNull();

    const krl = await getSshKrlService().revokeByCert(ctx, certId, 'compromised');
    expect(krl.revokedCount).toBeGreaterThanOrEqual(1);
    expect(krl.hasSignature).toBe(true); // detached CA signature present

    const res = await app.inject({ method: 'GET', url: `/krl/${caId}.bin` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-krl-version']).toBe(krl.versionHash);
    // serve the exact bytes and confirm sshd-side tooling treats the cert as revoked
    const served = join(work, 'served_krl');
    writeFileSync(served, res.rawPayload);
    expect(isRevoked(served, hostCertPath)).toBe(true);
  });

  it('returns 304 for a matching If-None-Match (ETag)', async () => {
    const first = await app.inject({ method: 'GET', url: `/krl/${caId}.bin` });
    const etag = first.headers['etag'] as string;
    const second = await app.inject({ method: 'GET', url: `/krl/${caId}.bin`, headers: { 'if-none-match': etag } });
    expect(second.statusCode).toBe(304);
    expect(second.rawPayload.length).toBe(0);
  });

  it('serves a signed envelope (bare KRL + detached signature + version) for the puller', async () => {
    const res = await app.inject({ method: 'GET', url: `/krl/${caId}.json` });
    expect(res.statusCode).toBe(200);
    const env = res.json();
    expect(env.krl_b64).toBeTruthy();
    expect(env.ca_signature_b64).toBeTruthy();
    expect(env.krl_version).toMatch(/^sha256:/);
    // the detached signature verifies against the Host CA public key in KMS
    const blob = Buffer.from(env.krl_b64, 'base64');
    const sig = Buffer.from(env.ca_signature_b64, 'base64');
    const caRow = (await db.select().from(sshCas).where(eq(sshCas.id, caId)).limit(1))[0] as any;
    const ok = await getKMSService().signatureVerify(caRow.kmsPublicKeyId, blob, sig);
    expect(ok).toBe(true);
  });

  it('404s for an unknown CA', async () => {
    expect((await app.inject({ method: 'GET', url: '/krl/nope.bin' })).statusCode).toBe(404);
  });
});
