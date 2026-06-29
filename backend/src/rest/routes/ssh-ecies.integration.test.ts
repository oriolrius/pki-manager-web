/**
 * SSH-15 + SSH-24 — register a per-host ECIES key, fetch the encrypted KRL, and
 * decrypt it host-side (via the host's KMS key), confirming the recovered bare
 * KRL revokes the cert (ssh-keygen -Q) and the detached signature verifies.
 * Gated on KMS_AVAILABLE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { registerSshExternalRoutes } from './ssh-external.routes.js';
import { db } from '../../db/client.js';
import { sshCas, sshHosts, sshIdentities, sshCertificates, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshPrincipals, sshFleetTokens, sshIdempotency } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshKrlService } from '../../services/ssh-krl.service.js';

const KMS = process.env.KMS_AVAILABLE === 'true';
const ctx = { db, ipAddress: null };

async function wipe() {
  const cas = await db.select().from(sshCas);
  const kms = getKMSService();
  for (const c of cas as any[]) { try { await kms.destroyKeyPair(c.kmsKeyId, c.kmsPublicKeyId); } catch { /* */ } }
  const hosts = await db.select().from(sshHosts);
  for (const h of hosts as any[]) {
    if (h.kmsPubkeyId) { try { await kms.destroyKeyPair(String(h.kmsPubkeyId).replace(/_pk$/, ''), h.kmsPubkeyId); } catch { /* */ } }
  }
  for (const t of [sshIdempotency, sshFleetTokens, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
}

describe.skipIf(!KMS)('SSH-15/24 ECIES per-host KRL distribution', () => {
  let app: FastifyInstance;
  let work: string;
  let hostPrivKeyId: string;
  let certPath: string;

  beforeAll(async () => {
    process.env.SSH_ECIES_ENABLED = 'true';
    work = mkdtempSync(join(tmpdir(), 'ssh-ecies-it-'));
    await wipe();
    app = Fastify();
    registerSshExternalRoutes(app);
    await app.ready();

    await getSshCaService().create(ctx, { caType: 'user' });
    await getSshCaService().create(ctx, { caType: 'host' });
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'h'), '-N', '', '-q']);
    const host = await getSshHostService().register(ctx, { fqdn: 'ecies.lab.local', addresses: ['10.0.0.30'], opensshHostPubkey: readFileSync(join(work, 'h.pub'), 'utf8') });
    const issued = await getSshHostService().issue(ctx, { hostId: host.id });
    certPath = join(work, 'h-cert.pub');
    writeFileSync(certPath, issued.cert.certOpenssh);
    // register the host's ECIES key
    const ids = await getSshHostService().registerEciesKey(ctx, host.id);
    hostPrivKeyId = ids.kmsPrivateKeyId;
    // revoke the cert so the KRL is non-empty
    await getSshKrlService().revokeByCert(ctx, issued.cert.id, 'rotation');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await wipe();
    delete process.env.SSH_ECIES_ENABLED;
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('delivers an ECIES-encrypted KRL only the host can decrypt, revoking the cert', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/external/ssh/krl', payload: { host_id: 'ecies.lab.local' } });
    expect(res.statusCode).toBe(200);
    const version = res.headers['x-krl-version'] as string;
    expect(version).toMatch(/^sha256:/);

    // Host-side: decrypt with its KMS private key (the puller path).
    const plaintext = await getKMSService().eciesDecrypt(hostPrivKeyId, res.rawPayload);
    const payload = JSON.parse(plaintext.toString('utf8'));
    expect(payload.host_id).toBe('ecies.lab.local');
    expect(payload.krl_version).toBe(version);
    expect(payload.valid_until).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // The recovered bare KRL revokes the cert per ssh-keygen -Q.
    const krlBytes = Buffer.from(payload.krl, 'base64');
    const krlPath = join(work, 'recovered_krl');
    writeFileSync(krlPath, krlBytes);
    const q = spawnSync('ssh-keygen', ['-Q', '-f', krlPath, certPath], { encoding: 'utf8' });
    expect(q.status !== 0 && /REVOKED/i.test(q.stdout + q.stderr)).toBe(true);

    // The detached CA signature verifies.
    const caRow = (await db.select().from(sshCas).where(eq(sshCas.caType, 'host')).limit(1))[0] as any;
    const ok = await getKMSService().signatureVerify(caRow.kmsPublicKeyId, krlBytes, Buffer.from(payload.ca_signature, 'base64'));
    expect(ok).toBe(true);
  });

  it('returns 304 when the host already holds the current KRL version', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/v1/external/ssh/krl', payload: { host_id: 'ecies.lab.local' } });
    const version = first.headers['x-krl-version'] as string;
    const second = await app.inject({ method: 'POST', url: '/api/v1/external/ssh/krl', headers: { 'if-none-match': version }, payload: { host_id: 'ecies.lab.local' } });
    expect(second.statusCode).toBe(304);
  });

  it('404s an unregistered host and 400s a malformed host_id', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/external/ssh/krl', payload: { host_id: 'nope.lab.local' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/external/ssh/krl', payload: { host_id: 'bad host!' } })).statusCode).toBe(400);
  });
});
