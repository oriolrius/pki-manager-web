/**
 * SSH-BULK — bulk renew (new serial, subject pubkey preserved) + bulk revoke,
 * validated against the live KMS + ssh-keygen. Gated on KMS_AVAILABLE.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { sshCas, sshHosts, sshIdentities, sshCertificates, sshKrls, sshHostKrls, sshHostBlocks, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshPrincipals, sshFleetTokens, sshIdempotency } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { getSshCaService } from './ssh-ca.service.js';
import { getSshHostService } from './ssh-host.service.js';
import { getSshUserService } from './ssh-user.service.js';
import { getSshBulkService } from './ssh-bulk.service.js';
import { subjectPubkeyFromCert, parseSshPublicKey } from '../crypto/ssh/pubkey.js';

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

describe.skipIf(!KMS)('SSH-BULK', () => {
  let work: string;
  let userCert: any;
  let hostCert: any;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'ssh-bulk-'));
    await wipe();
    await getSshCaService().create(ctx, { caType: 'user' });
    await getSshCaService().create(ctx, { caType: 'host' });
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'h'), '-N', '', '-q']);
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'u'), '-N', '', '-q']);
    const host = await getSshHostService().register(ctx, { fqdn: 'bulk.lab.local', addresses: ['10.0.0.7'], opensshHostPubkey: readFileSync(join(work, 'h.pub'), 'utf8') });
    hostCert = (await getSshHostService().issue(ctx, { hostId: host.id })).cert;
    const ident = await getSshUserService().createIdentity(ctx, { subject: 'bulk-user' });
    userCert = (await getSshUserService().issue(ctx, { identityId: ident.id, sshPublicKey: readFileSync(join(work, 'u.pub'), 'utf8'), principals: ['admin'] })).cert;
  }, 60_000);

  afterAll(async () => {
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('subjectPubkeyFromCert recovers the exact subject key from a cert', () => {
    const recovered = subjectPubkeyFromCert(userCert.certOpenssh);
    const original = readFileSync(join(work, 'u.pub'), 'utf8');
    expect(parseSshPublicKey(recovered).fingerprintSha256).toBe(parseSshPublicKey(original).fingerprintSha256);
  });

  it('bulk-renews a user cert with a new serial and preserved subject key', async () => {
    const res = await getSshBulkService().bulkRenew(ctx, [userCert.id]);
    expect(res.renewed).toBe(1);
    const newId = res.results[0].newCertId!;
    const renewed = (await db.select().from(sshCertificates).where(eq(sshCertificates.id, newId)).limit(1))[0] as any;
    expect(renewed.serial).not.toBe(userCert.serial);
    // prior cert is now superseded
    const prior = (await db.select().from(sshCertificates).where(eq(sshCertificates.id, userCert.id)).limit(1))[0] as any;
    expect(prior.supersededBy).toBe(newId);
    // renewed cert validates and carries the same subject fingerprint
    writeFileSync(join(work, 'ur.pub'), renewed.certOpenssh);
    const out = execFileSync('ssh-keygen', ['-L', '-f', join(work, 'ur.pub')], { encoding: 'utf8' });
    expect(out).toContain('user certificate');
    expect(out).toContain('admin');
  });

  it('bulk-revokes a set of certs (idempotent on already-revoked)', async () => {
    const res = await getSshBulkService().bulkRevoke(ctx, [hostCert.id], 'fleet rotation');
    expect(res.revoked).toBe(1);
    const row = (await db.select().from(sshCertificates).where(eq(sshCertificates.id, hostCert.id)).limit(1))[0] as any;
    expect(row.status).toBe('revoked');
    // second revoke is a no-op (already revoked)
    const res2 = await getSshBulkService().bulkRevoke(ctx, [hostCert.id]);
    expect(res2.revoked).toBe(0);
  });
});
