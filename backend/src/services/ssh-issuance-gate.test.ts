/**
 * BLK-13 (TASK-190) — the OPTIONAL flag-gated issuance gate. Flag OFF must be
 * a byte-for-byte no-op; flag ON narrows a blocked identity's principals to
 * host-scoped P@<fqdn> forms excluding blocked hosts, on every issuance path
 * through the sign() choke point (issue and renew tested here). render()
 * pre-provisions the dual-form auth_principals lines unconditionally.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sshCas, sshCertificates, sshRevocations, sshHosts, sshIdentities, sshHostBlocks, sshHostKrls, sshKrls, sshPrincipals, sshUserPrincipals, sshHostPrincipalMaps } from '../db/schema.js';
import { getSshCertService, SshPrincipalsNarrowedEmptyError } from './ssh-cert.service.js';
import { getSshUserService } from './ssh-user.service.js';
import { getSshPrincipalService } from './ssh-principal.service.js';

const { signRawMock } = vi.hoisted(() => ({
  signRawMock: vi.fn(async () => {
    const der = Buffer.concat([
      Buffer.from([0x30, 68 + 2, 0x02, 33, 0x00]),
      Buffer.alloc(32, 7),
      Buffer.from([0x02, 33, 0x00]),
      Buffer.alloc(32, 9),
    ]);
    return der;
  }),
}));
vi.mock('../kms/service.js', () => ({
  getKMSService: () => ({ signRaw: signRawMock }),
}));

const ctx = { db, ipAddress: null };

async function wipe() {
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
}

describe('BLK-13 issuance gate', () => {
  let work: string;
  let alicePub: string;
  const ids = {
    caUser: randomUUID(),
    hostY: randomUUID(), // blocked
    hostZ: randomUUID(), // allowed
    hostOff: randomUUID(), // offboarded (must never yield scoped forms)
    alice: randomUUID(),
    roleAdmin: randomUUID(),
    roleDev: randomUUID(),
  };

  const signAlice = (principals: string[]) =>
    getSshCertService().sign(ctx, {
      caId: ids.caUser,
      sshPublicKey: alicePub,
      type: 'user',
      keyId: 'alice@lab',
      principals,
      validForSeconds: 3600,
      identityId: ids.alice,
    });

  beforeAll(async () => {
    await wipe();
    work = mkdtempSync(join(tmpdir(), 'blk13-'));
    execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, 'caU'), '-N', '', '-q']);
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'alice'), '-N', '', '-q']);
    alicePub = readFileSync(join(work, 'alice.pub'), 'utf8').trim();

    await db.insert(sshCas).values({
      id: ids.caUser, caType: 'user', kmsKeyId: 'k-u', kmsPublicKeyId: 'kp-u',
      opensshPublicKey: readFileSync(join(work, 'caU.pub'), 'utf8').trim(), fingerprintSha256: 'SHA256:u', status: 'active',
    } as any);
    await db.insert(sshHosts).values([
      { id: ids.hostY, fqdn: 'y.lab', status: 'active' },
      { id: ids.hostZ, fqdn: 'z.lab', status: 'active' },
      { id: ids.hostOff, fqdn: 'off.lab', status: 'offboarded' },
    ] as any);
    await db.insert(sshIdentities).values({ id: ids.alice, subject: 'alice@lab' } as any);
    await db.insert(sshPrincipals).values([
      { id: ids.roleAdmin, name: 'admin' },
      { id: ids.roleDev, name: 'dev' },
    ] as any);
    // admin maps on Y, Z and the offboarded host; dev maps ONLY on Y.
    await db.insert(sshHostPrincipalMaps).values([
      { id: randomUUID(), hostId: ids.hostY, principalId: ids.roleAdmin, localAccount: 'root' },
      { id: randomUUID(), hostId: ids.hostZ, principalId: ids.roleAdmin, localAccount: 'root' },
      { id: randomUUID(), hostId: ids.hostOff, principalId: ids.roleAdmin, localAccount: 'root' },
      { id: randomUUID(), hostId: ids.hostY, principalId: ids.roleDev, localAccount: 'deploy' },
    ] as any);
  });

  beforeEach(() => {
    delete process.env.SSH_BLOCK_ISSUANCE_GATE;
  });

  afterAll(async () => {
    delete process.env.SSH_BLOCK_ISSUANCE_GATE;
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('flag OFF: zero behavior change even with an active block', async () => {
    await db.insert(sshHostBlocks).values({ id: randomUUID(), hostId: ids.hostY, identityId: ids.alice, reason: 'gate-test' } as any);
    const signed = await signAlice(['admin', 'dev']);
    const row = (await db.select().from(sshCertificates).where(eq(sshCertificates.id, signed.id)))[0] as any;
    expect(JSON.parse(row.principals)).toEqual(['admin', 'dev']); // untouched bare forms
  });

  it('flag ON + no blocks: principals pass through untouched', async () => {
    await db.delete(sshHostBlocks);
    process.env.SSH_BLOCK_ISSUANCE_GATE = 'true';
    const signed = await signAlice(['admin']);
    const row = (await db.select().from(sshCertificates).where(eq(sshCertificates.id, signed.id)))[0] as any;
    expect(JSON.parse(row.principals)).toEqual(['admin']);
  });

  it('flag ON + block on Y: cert is born with scoped principals that exclude Y (and offboarded hosts)', async () => {
    await db.insert(sshHostBlocks).values({ id: randomUUID(), hostId: ids.hostY, identityId: ids.alice, reason: 'gate' } as any);
    process.env.SSH_BLOCK_ISSUANCE_GATE = 'true';
    const signed = await signAlice(['admin', 'dev']);
    const row = (await db.select().from(sshCertificates).where(eq(sshCertificates.id, signed.id)))[0] as any;
    // admin resolves to Z only (Y blocked, off.lab offboarded); dev maps only on Y → dropped.
    expect(JSON.parse(row.principals)).toEqual(['admin@z.lab']);
    // Surfaced in the UI listing (users page principals column).
    const listed = await getSshUserService().listCertificates(ctx, ids.alice);
    expect(listed.find((c: any) => c.id === signed.id)!.principals).toEqual(['admin@z.lab']);
  });

  it('flag ON: renew() flows through the same narrowing (bulkRenew/external share the choke point)', async () => {
    process.env.SSH_BLOCK_ISSUANCE_GATE = 'true';
    const prior = (await db.select().from(sshCertificates).where(eq(sshCertificates.identityId, ids.alice)))[0] as any;
    const renewed = await getSshCertService().renew(ctx, {
      caId: ids.caUser,
      sshPublicKey: alicePub,
      type: 'user',
      keyId: 'alice@lab',
      principals: ['admin'],
      validForSeconds: 3600,
      identityId: ids.alice,
      supersedesCertId: prior.id,
    });
    const row = (await db.select().from(sshCertificates).where(eq(sshCertificates.id, renewed.id)))[0] as any;
    expect(JSON.parse(row.principals)).toEqual(['admin@z.lab']);
  });

  it('flag ON: refuses to issue when every principal resolves only to blocked hosts', async () => {
    process.env.SSH_BLOCK_ISSUANCE_GATE = 'true';
    await expect(signAlice(['dev'])).rejects.toThrow(SshPrincipalsNarrowedEmptyError); // dev maps only on blocked Y
  });

  it('render() pre-provisions dual P + P@<fqdn> lines unconditionally; drift flow intact', async () => {
    delete process.env.SSH_BLOCK_ISSUANCE_GATE; // dual lines are NOT flag-gated
    const rendered = await getSshPrincipalService().render(ctx, ids.hostY);
    expect(rendered.files.root).toBe('admin\nadmin@y.lab\n');
    expect(rendered.files.deploy).toBe('dev\ndev@y.lab\n');
    expect(typeof rendered.stale).toBe('boolean');
    await getSshPrincipalService().markPushed(ctx, ids.hostY);
    const after = await getSshPrincipalService().render(ctx, ids.hostY);
    expect(after.stale).toBe(false);
  });
});
