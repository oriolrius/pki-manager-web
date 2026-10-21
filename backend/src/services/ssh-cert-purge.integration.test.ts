/**
 * SSH cert purge (TASK-234) — hard-delete a mis-issued certificate.
 *
 * Proves the KRL-safety contract of SshKrlService.purgeCert:
 *  - active (never revoked) cert  → pure purge, no KRL regen (serial was never in it)
 *  - revoked + still valid        → needs force; serial preserved by default, dropped only on request
 *  - expired                      → purges freely
 *  - always audited; second purge is a not-found, never a crash
 *
 * KMS signRaw is mocked (the KRL detached signature is not what we assert here);
 * the CA public key is a real ssh-keygen artefact so buildKrl can parse it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLog, sshCas, sshCertificates, sshRevocations, sshKrls, sshHosts, sshIdentities, sshHostBlocks, sshHostKrls } from '../db/schema.js';
import { parseSshPublicKey } from '../crypto/ssh/pubkey.js';
import { getSshKrlService, SshCertPurgeForbiddenError } from './ssh-krl.service.js';

vi.mock('../kms/service.js', () => ({
  getKMSService: () => ({ signRaw: vi.fn(async () => Buffer.from('detached-sig')) }),
}));

const ctx = { db, ipAddress: '10.0.0.9' };
const svc = getSshKrlService();

async function wipe(): Promise<void> {
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshCertificates, sshHosts, sshIdentities, sshCas]) {
    await db.delete(t);
  }
  await db.delete(auditLog).where(eq(auditLog.operation, 'ssh.cert.purge'));
}

describe('TASK-234 — SshKrlService.purgeCert', () => {
  let work: string;
  let caPub: string;

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'ssh-purge-'));
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'ca'), '-N', '', '-q']);
    caPub = readFileSync(join(work, 'ca.pub'), 'utf8').trim();
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  beforeEach(wipe);

  async function seedCa(): Promise<string> {
    const id = randomUUID();
    const blob = parseSshPublicKey(caPub).blob;
    const fp = 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
    await db.insert(sshCas).values({
      id,
      caType: 'user',
      kmsKeyId: 'kms-ca',
      kmsPublicKeyId: 'kms-ca-pk',
      opensshPublicKey: caPub,
      fingerprintSha256: fp,
      status: 'active',
    } as any);
    return id;
  }

  async function seedCert(
    caId: string,
    opts: { status?: 'active' | 'revoked'; validBeforeMs?: number } = {}
  ): Promise<{ id: string; serial: string }> {
    const id = randomUUID();
    const serial = String(Math.floor(Math.random() * 1e12));
    await db.insert(sshCertificates).values({
      id,
      caId,
      certType: 'user',
      serial,
      keyId: `kid-${serial}`,
      principals: JSON.stringify(['alice']),
      validAfter: new Date(Date.now() - 3_600_000),
      validBefore: new Date(opts.validBeforeMs ?? Date.now() + 3_600_000),
      certOpenssh: 'ecdsa-sha2-nistp256-cert-v01@openssh.com AAAAtest kid',
      subjectPubkeyFingerprint: 'SHA256:' + randomUUID(),
      kmsSigningKeyId: 'kms-ca',
      status: opts.status ?? 'active',
      revocationDate: opts.status === 'revoked' ? new Date() : null,
    } as any);
    return { id, serial };
  }

  const certGone = async (id: string) => (await db.select().from(sshCertificates).where(eq(sshCertificates.id, id))).length === 0;
  const serialDirectives = async (serial: string) =>
    db.select().from(sshRevocations).where(and(eq(sshRevocations.serial, serial), eq(sshRevocations.targetType, 'serial')));
  const purgeAudits = async () => db.select().from(auditLog).where(eq(auditLog.operation, 'ssh.cert.purge'));

  it('active (never revoked) cert purges purely: row gone, KRL untouched, still audited', async () => {
    const caId = await seedCa();
    const { id, serial } = await seedCert(caId, {});

    const res = await svc.purgeCert(ctx, id, {});

    expect(res.ok).toBe(true);
    expect(res.preservedSerial).toBe(false);
    expect(res.removedFromKrl).toBe(false);
    expect(res.krl).toBeNull(); // an active cert was never in the KRL → no regen
    expect(await certGone(id)).toBe(true);
    expect(await serialDirectives(serial)).toHaveLength(0);
    expect(await purgeAudits()).toHaveLength(1);
  });

  it('revoked + still valid without force → 409-class SshCertPurgeForbiddenError, cert untouched', async () => {
    const caId = await seedCa();
    const { id } = await seedCert(caId, { status: 'revoked' });

    await expect(svc.purgeCert(ctx, id, {})).rejects.toBeInstanceOf(SshCertPurgeForbiddenError);
    expect(await certGone(id)).toBe(false);
  });

  it('revoked + still valid with force (default) preserves the serial in the KRL', async () => {
    const caId = await seedCa();
    const { id, serial } = await seedCert(caId, { status: 'revoked' });

    const res = await svc.purgeCert(ctx, id, { force: true });

    expect(res.preservedSerial).toBe(true);
    expect(res.removedFromKrl).toBe(false);
    expect(res.krl).not.toBeNull(); // regenerated so the standalone directive is published
    expect(await certGone(id)).toBe(true);
    expect(await serialDirectives(serial)).toHaveLength(1); // serial stays revoked without the cert row
  });

  it('revoked + still valid with force + dropRevocation removes the serial from the KRL', async () => {
    const caId = await seedCa();
    const { id, serial } = await seedCert(caId, { status: 'revoked' });
    // mimic revokeByCert having written a targetType='cert' directive for this cert
    await db.insert(sshRevocations).values({ id: randomUUID(), caId, targetType: 'cert', certId: id, serial } as any);

    const res = await svc.purgeCert(ctx, id, { force: true, dropRevocation: true });

    expect(res.preservedSerial).toBe(false);
    expect(res.removedFromKrl).toBe(true);
    expect(await certGone(id)).toBe(true);
    // neither the old cert-directive nor a new serial-directive survives → serial leaves the KRL
    expect((await db.select().from(sshRevocations).where(eq(sshRevocations.serial, serial)))).toHaveLength(0);
  });

  it('expired revoked cert purges without force and does not flag a security-relevant KRL removal', async () => {
    const caId = await seedCa();
    const { id } = await seedCert(caId, { status: 'revoked', validBeforeMs: Date.now() - 1000 });

    const res = await svc.purgeCert(ctx, id, {});

    expect(res.ok).toBe(true);
    expect(res.preservedSerial).toBe(false);
    expect(res.removedFromKrl).toBe(false); // expired: the clock already rejects it
    expect(await certGone(id)).toBe(true);
  });

  it('is idempotent: a second purge of the same id is a not-found, never a crash', async () => {
    const caId = await seedCa();
    const { id } = await seedCert(caId, {});

    await svc.purgeCert(ctx, id, {});
    await expect(svc.purgeCert(ctx, id, {})).rejects.toThrow(/not found/i);
  });
});
