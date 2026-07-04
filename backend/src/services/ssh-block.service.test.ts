/**
 * BLK-04 (TASK-181) — SshBlockService: block/unblock round-trip with
 * synchronous per-host KRL regeneration, audit on success AND failure,
 * shared-fingerprint over-block detection, and the decision-016 lifecycle
 * interactions (disabled identity blockable, identity offboard supersedes,
 * host offboard retires the lineage but keeps rows). KMS signRaw mocked.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLog, sshCas, sshCertificates, sshRevocations, sshHosts, sshIdentities, sshHostBlocks, sshHostKrls, sshKrls } from '../db/schema.js';
import { parseSshPublicKey } from '../crypto/ssh/pubkey.js';
import { getSshBlockService, SshBlockError } from './ssh-block.service.js';
import { getSshHostKrlService } from './ssh-host-krl.service.js';
import { getSshUserService } from './ssh-user.service.js';
import { getSshHostService } from './ssh-host.service.js';

const { signRawMock } = vi.hoisted(() => ({
  signRawMock: vi.fn(async () => Buffer.from('detached-der-signature')),
}));
vi.mock('../kms/service.js', () => ({
  getKMSService: () => ({ signRaw: signRawMock, destroyKeyPair: vi.fn() }),
}));

const ctx = { db, ipAddress: '10.9.9.9' };
const svc = getSshBlockService();
const keygen = (args: string[]) => execFileSync('ssh-keygen', args, { stdio: 'pipe' });

async function wipe() {
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshCertificates, sshHosts, sshIdentities, sshCas]) {
    await db.delete(t);
  }
  await db.delete(auditLog).where(eq(auditLog.operation, 'ssh.host.block'));
  await db.delete(auditLog).where(eq(auditLog.operation, 'ssh.host.unblock'));
}

async function auditRows(op: 'ssh.host.block' | 'ssh.host.unblock', status: 'success' | 'failure') {
  return (await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.operation, op), eq(auditLog.status, status)))) as any[];
}

describe('BLK-04 SshBlockService', () => {
  let work: string;
  const ids = {
    caUser: randomUUID(),
    caHost: randomUUID(),
    hostY: randomUUID(),
    hostZ: randomUUID(),
    alice: randomUUID(),
    bob: randomUUID(),
    carol: randomUUID(),
  };
  let sharedFp: string;

  beforeAll(async () => {
    await wipe();
    work = mkdtempSync(join(tmpdir(), 'blk04-'));
    for (const n of ['caU', 'caH']) keygen(['-t', 'ecdsa', '-b', '256', '-f', join(work, n), '-N', '', '-q']);
    keygen(['-t', 'ed25519', '-f', join(work, 'shared'), '-N', '', '-q']);
    const caPub = (n: string) => readFileSync(join(work, `${n}.pub`), 'utf8').trim();
    sharedFp =
      'SHA256:' +
      createHash('sha256')
        .update(parseSshPublicKey(readFileSync(join(work, 'shared.pub'), 'utf8')).blob)
        .digest('base64')
        .replace(/=+$/, '');

    await db.insert(sshCas).values([
      { id: ids.caUser, caType: 'user', kmsKeyId: 'k-u', kmsPublicKeyId: 'kp-u', opensshPublicKey: caPub('caU'), fingerprintSha256: 'SHA256:u', status: 'active' },
      { id: ids.caHost, caType: 'host', kmsKeyId: 'k-h', kmsPublicKeyId: 'kp-h', opensshPublicKey: caPub('caH'), fingerprintSha256: 'SHA256:h', status: 'active' },
    ] as any);
    await db.insert(sshHosts).values([
      { id: ids.hostY, fqdn: 'y.lab.local', status: 'active' },
      { id: ids.hostZ, fqdn: 'z.lab.local', status: 'active' },
    ] as any);
    await db.insert(sshIdentities).values([
      { id: ids.alice, subject: 'alice@lab' },
      { id: ids.bob, subject: 'bob@lab', status: 'disabled' },
      { id: ids.carol, subject: 'carol@lab' },
    ] as any);

    // alice and carol share a public key (over-block scenario); alice also has
    // an unexpired active cert so offboard-supersession stays false until revoked.
    const cert = (identityId: string, serial: string, fp: string) => ({
      id: randomUUID(),
      caId: ids.caUser,
      certType: 'user',
      identityId,
      serial,
      keyId: `k-${serial}`,
      principals: '[]',
      validAfter: new Date(Date.now() - 3600_000),
      validBefore: new Date(Date.now() + 6 * 24 * 3600_000),
      certOpenssh: 'unused',
      subjectPubkeyFingerprint: fp,
      kmsSigningKeyId: 'kms',
      status: 'active',
    });
    await db.insert(sshCertificates).values([
      cert(ids.alice, '1', sharedFp),
      cert(ids.carol, '2', sharedFp),
      cert(ids.alice, '3', 'SHA256:' + createHash('sha256').update('alice-other').digest('base64').replace(/=+$/, '')),
    ] as any);
  });

  afterAll(async () => {
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('block → unblock → re-block round-trip; each mutation yields a fresh per-host KRL with a higher number', async () => {
    const b1 = await svc.block(ctx, { hostId: ids.hostY, identityId: ids.alice, reason: 'incident', createdBy: 'or' });
    expect(b1.block.status).toBe('active');
    expect(b1.block.reason).toBe('incident');
    expect(b1.block.createdBy).toBe('or');
    expect(b1.krl?.blockCount).toBe(1);

    // Partial-unique: second active block on the same pair → friendly error.
    await expect(svc.block(ctx, { hostId: ids.hostY, identityId: ids.alice })).rejects.toThrow(/already blocked/);

    const u1 = await svc.unblock(ctx, { hostId: ids.hostY, identityId: ids.alice, liftedBy: 'or' });
    expect(u1.block.status).toBe('lifted');
    expect(u1.block.liftedBy).toBe('or');
    expect(u1.krl!.krlNumber).toBeGreaterThan(b1.krl!.krlNumber);
    expect(u1.krl?.blockCount).toBe(0);

    const b2 = await svc.block(ctx, { hostId: ids.hostY, identityId: ids.alice, reason: 'again' });
    expect(b2.krl!.krlNumber).toBeGreaterThan(u1.krl!.krlNumber);

    // Lifted history retained.
    const all = await db.select().from(sshHostBlocks).where(eq(sshHostBlocks.identityId, ids.alice));
    expect(all).toHaveLength(2);
    await svc.unblock(ctx, { hostId: ids.hostY, identityId: ids.alice });
  });

  it('audits success and failure for both operations', async () => {
    expect((await auditRows('ssh.host.block', 'success')).length).toBeGreaterThanOrEqual(2);
    expect((await auditRows('ssh.host.unblock', 'success')).length).toBeGreaterThanOrEqual(2);
    // Failure paths: duplicate block (above) + unblocking a non-blocked pair.
    expect((await auditRows('ssh.host.block', 'failure')).length).toBeGreaterThanOrEqual(1);
    await expect(svc.unblock(ctx, { hostId: ids.hostY, identityId: ids.carol })).rejects.toThrow(SshBlockError);
    const fails = await auditRows('ssh.host.unblock', 'failure');
    expect(fails.length).toBeGreaterThanOrEqual(1);
    const d = JSON.parse(fails[fails.length - 1].details);
    expect(d).toMatchObject({ identityId: ids.carol, hostId: ids.hostY });
  });

  it('detects shared-fingerprint over-block collisions at block time', async () => {
    const res = await svc.block(ctx, { hostId: ids.hostZ, identityId: ids.alice, reason: 'shared-key check' });
    expect(res.warnings.sharedKeyCollisions).toEqual([
      { identityId: ids.carol, subject: 'carol@lab', fingerprint: sharedFp },
    ]);
    await svc.unblock(ctx, { hostId: ids.hostZ, identityId: ids.alice });
  });

  it('listForHost / listForIdentity return reason/by/when/status', async () => {
    await svc.block(ctx, { hostId: ids.hostY, identityId: ids.alice, reason: 'r1', createdBy: 'op1' });
    const forHost = await svc.listForHost(ctx, ids.hostY);
    expect(forHost.length).toBeGreaterThanOrEqual(1);
    const active = forHost.find((b) => b.status === 'active')!;
    expect(active).toMatchObject({ subject: 'alice@lab', fqdn: 'y.lab.local', reason: 'r1', createdBy: 'op1', supersededByOffboard: false });
    expect(active.createdAt).toMatch(/^\d{4}-/);

    const forIdent = await svc.listForIdentity(ctx, ids.alice);
    expect(forIdent.some((b) => b.hostId === ids.hostY && b.status === 'active')).toBe(true);
    expect(forIdent.every((b) => b.fqdn !== null)).toBe(true);
  });

  it('a failed synchronous regen clamps the host lineage so the lazy backstop fires on the next pull', async () => {
    // Fresh baseline row, then break generation (no CAs at all).
    await getSshHostKrlService().generate(ctx, ids.hostZ);
    const before = await getSshHostKrlService().getLatestRow(ctx, ids.hostZ);
    expect(new Date(before.nextUpdate).getTime()).toBeGreaterThan(Date.now());

    const cas = await db.select().from(sshCas);
    await db.delete(sshCas);
    try {
      const res = await svc.block(ctx, { hostId: ids.hostZ, identityId: ids.carol, reason: 'regen-fail' });
      expect(res.krl).toBeNull(); // sync regen failed, block row persisted
      const after = await getSshHostKrlService().getLatestRow(ctx, ids.hostZ);
      expect(after.id).toBe(before.id); // no new row ...
      expect(new Date(after.nextUpdate).getTime()).toBeLessThanOrEqual(Date.now()); // ... but clamped
    } finally {
      await db.insert(sshCas).values(cas as any);
      await svc.unblock(ctx, { hostId: ids.hostZ, identityId: ids.carol });
    }
  });

  it('lifecycle: a disabled identity is blockable (pre-emptive)', async () => {
    const res = await svc.block(ctx, { hostId: ids.hostY, identityId: ids.bob, reason: 'pre-emptive' });
    expect(res.block.status).toBe('active');
    // bob is disabled with no live certs → already annotated as superseded.
    expect(res.block.supersededByOffboard).toBe(true);
  });

  it('lifecycle: identity offboard supersedes blocks — rows stay, annotation flips', async () => {
    const before = await svc.listForIdentity(ctx, ids.alice);
    expect(before.find((b) => b.status === 'active')!.supersededByOffboard).toBe(false);

    await getSshUserService().offboard(ctx, ids.alice, 'left the company');

    const after = await svc.listForIdentity(ctx, ids.alice);
    expect(after.length).toBe(before.length); // nothing deleted
    expect(after.find((b) => b.status === 'active')!.supersededByOffboard).toBe(true);
  });

  it('lifecycle: host offboard retires the per-host lineage and keeps block rows; new blocks rejected', async () => {
    const rowsBefore = await svc.listForHost(ctx, ids.hostY);
    await getSshHostService().offboard(ctx, ids.hostY, 'decommissioned');

    // Lineage retired: no further per-host KRLs.
    await expect(getSshHostKrlService().generate(ctx, ids.hostY)).rejects.toThrow(/retired/);
    // Rows kept for audit.
    const rowsAfter = await svc.listForHost(ctx, ids.hostY);
    expect(rowsAfter.length).toBe(rowsBefore.length);
    // A new block on the offboarded host could never be enforced → rejected.
    await expect(svc.block(ctx, { hostId: ids.hostY, identityId: ids.carol })).rejects.toThrow(/offboarded/);
  });
});
