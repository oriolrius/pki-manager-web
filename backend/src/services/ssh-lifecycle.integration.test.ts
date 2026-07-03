/**
 * SSH-32a/b/c — CA rotation (dual-trust overlap) + host/user offboarding,
 * against the live KMS. Gated on KMS_AVAILABLE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sshCas, sshHosts, sshIdentities, sshCertificates, sshKrls, sshHostKrls, sshHostBlocks, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshPrincipals, sshFleetTokens, sshIdempotency } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { getSshCaService } from './ssh-ca.service.js';
import { getSshHostService } from './ssh-host.service.js';
import { getSshUserService } from './ssh-user.service.js';

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

describe.skipIf(!KMS)('SSH-32 lifecycle', () => {
  let work: string;
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'ssh-life-'));
    await wipe();
  }, 60_000);
  afterAll(async () => {
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('rotates a CA: predecessor stays trusted (both keys published), successor signs new certs', async () => {
    const userCa = await getSshCaService().create(ctx, { caType: 'user' });
    const { predecessor, successor } = await getSshCaService().rotate(ctx, userCa.id);
    expect(predecessor.status).toBe('rotating');
    expect(successor.status).toBe('active');
    expect(successor.predecessorCaId).toBe(userCa.id);

    const anchors = await getSshCaService().getTrustAnchors(ctx);
    expect(anchors.userCaKeys).toHaveLength(2); // both predecessor + successor published

    // New issuance uses the active successor.
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'u'), '-N', '', '-q']);
    const ident = await getSshUserService().createIdentity(ctx, { subject: 'rot-user' });
    const cert = await getSshUserService().issue(ctx, { identityId: ident.id, sshPublicKey: readFileSync(join(work, 'u.pub'), 'utf8'), principals: ['admin'] });
    const certRow = (await db.select().from(sshCertificates).where(eq(sshCertificates.id, cert.cert.id)).limit(1))[0] as any;
    expect(certRow.caId).toBe(successor.id);

    // Retire the predecessor.
    const retired = await getSshCaService().retire(ctx, predecessor.id);
    expect(retired.status).toBe('retired');
    expect((await getSshCaService().getTrustAnchors(ctx)).userCaKeys).toHaveLength(1);
  });

  it('offboards a host in one action: revokes its cert, removes maps, sets offboarded', async () => {
    await getSshCaService().create(ctx, { caType: 'host' });
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'h'), '-N', '', '-q']);
    const host = await getSshHostService().register(ctx, { fqdn: 'off.lab.local', addresses: ['10.0.0.40'], opensshHostPubkey: readFileSync(join(work, 'h.pub'), 'utf8') });
    const issued = await getSshHostService().issue(ctx, { hostId: host.id });

    await getSshHostService().offboard(ctx, host.id);
    const row = (await db.select().from(sshHosts).where(eq(sshHosts.id, host.id)).limit(1))[0] as any;
    expect(row.status).toBe('offboarded');
    const cert = (await db.select().from(sshCertificates).where(eq(sshCertificates.id, issued.cert.id)).limit(1))[0] as any;
    expect(cert.status).toBe('revoked');
    // a KRL was produced for the host CA
    const krls = await db.select().from(sshKrls);
    expect(krls.length).toBeGreaterThanOrEqual(1);
    // offboarded host cannot be issued again
    await expect(getSshHostService().issue(ctx, { hostId: host.id })).rejects.toThrow(/offboarded/i);
  });

  it('offboards an identity: revokes its certs and disables new issuance', async () => {
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'u2'), '-N', '', '-q']);
    const ident = await getSshUserService().createIdentity(ctx, { subject: 'leaver' });
    const cert = await getSshUserService().issue(ctx, { identityId: ident.id, sshPublicKey: readFileSync(join(work, 'u2.pub'), 'utf8'), principals: ['admin'] });
    await getSshUserService().offboard(ctx, ident.id);
    const certRow = (await db.select().from(sshCertificates).where(eq(sshCertificates.id, cert.cert.id)).limit(1))[0] as any;
    expect(certRow.status).toBe('revoked');
    await expect(getSshUserService().issue(ctx, { identityId: ident.id, sshPublicKey: readFileSync(join(work, 'u2.pub'), 'utf8'), principals: ['admin'] })).rejects.toThrow(/disabled/i);
  });
});
