/**
 * BLK-05 (TASK-182) — issuance + revocation triggers for per-host KRL
 * freshness. KMS signRaw mocked; the wiring under test is pure DB/event flow:
 * every revocation entry point clamps per-host next_update (lazy backstop) and
 * eagerly regenerates ONLY hosts with active blocks, coalesced across offboard
 * loops; a new user cert for a blocked identity regenerates asynchronously;
 * block resolution provably ignores the caller-settable keyId.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { eq, gt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLog, sshCas, sshCertificates, sshRevocations, sshHosts, sshIdentities, sshHostBlocks, sshHostKrls, sshKrls } from '../db/schema.js';
import { parseSshPublicKey } from '../crypto/ssh/pubkey.js';
import { decodeKrl } from '../test/krl-decode.js';
import { getSshHostKrlService } from './ssh-host-krl.service.js';
import { getSshKrlService } from './ssh-krl.service.js';
import { getSshUserService } from './ssh-user.service.js';
import { getSshCertService } from './ssh-cert.service.js';

const { signRawMock } = vi.hoisted(() => ({
  // Valid-shape DER ECDSA signature so assembleSshCert can transcode it.
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
  getKMSService: () => ({ signRaw: signRawMock, destroyKeyPair: vi.fn() }),
}));

const ctx = { db, ipAddress: null };
const keygen = (args: string[]) => execFileSync('ssh-keygen', args, { stdio: 'pipe' });

async function wipe() {
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshCertificates, sshHosts, sshIdentities, sshCas]) {
    await db.delete(t);
  }
  await db.delete(auditLog).where(eq(auditLog.operation, 'ssh.host_krl.generate'));
}

async function hostKrlCount(hostId: string): Promise<number> {
  return (await db.select().from(sshHostKrls).where(eq(sshHostKrls.hostId, hostId))).length;
}

describe('BLK-05 issuance + revocation triggers', () => {
  let work: string;
  const ids = {
    caUser: randomUUID(),
    caHost: randomUUID(),
    hostBlocked: randomUUID(), // has an active block
    hostPlain: randomUUID(), // no blocks
    alice: randomUUID(), // blocked on hostBlocked
    mallory: randomUUID(), // NOT blocked; forges keyId
  };
  let alicePub: string;
  let malloryPub: string;

  const certRow = (o: { identityId: string; serial: string; keyId: string; fp?: string }) => ({
    id: randomUUID(),
    caId: ids.caUser,
    certType: 'user',
    identityId: o.identityId,
    serial: o.serial,
    keyId: o.keyId,
    principals: '[]',
    validAfter: new Date(Date.now() - 3600_000),
    validBefore: new Date(Date.now() + 6 * 24 * 3600_000),
    certOpenssh: 'unused',
    subjectPubkeyFingerprint: o.fp ?? 'SHA256:' + createHash('sha256').update(o.serial).digest('base64').replace(/=+$/, ''),
    kmsSigningKeyId: 'kms',
    status: 'active',
  });

  beforeAll(async () => {
    await wipe();
    work = mkdtempSync(join(tmpdir(), 'blk05-'));
    for (const n of ['caU', 'caH']) keygen(['-t', 'ecdsa', '-b', '256', '-f', join(work, n), '-N', '', '-q']);
    keygen(['-t', 'ed25519', '-f', join(work, 'alice'), '-N', '', '-q']);
    keygen(['-t', 'ed25519', '-f', join(work, 'mallory'), '-N', '', '-q']);
    alicePub = readFileSync(join(work, 'alice.pub'), 'utf8').trim();
    malloryPub = readFileSync(join(work, 'mallory.pub'), 'utf8').trim();
    const caPub = (n: string) => readFileSync(join(work, `${n}.pub`), 'utf8').trim();

    await db.insert(sshCas).values([
      { id: ids.caUser, caType: 'user', kmsKeyId: 'k-u', kmsPublicKeyId: 'kp-u', opensshPublicKey: caPub('caU'), fingerprintSha256: 'SHA256:u', status: 'active' },
      { id: ids.caHost, caType: 'host', kmsKeyId: 'k-h', kmsPublicKeyId: 'kp-h', opensshPublicKey: caPub('caH'), fingerprintSha256: 'SHA256:h', status: 'active' },
    ] as any);
    await db.insert(sshHosts).values([
      { id: ids.hostBlocked, fqdn: 'blocked.lab.local', status: 'active' },
      { id: ids.hostPlain, fqdn: 'plain.lab.local', status: 'active' },
    ] as any);
    await db.insert(sshIdentities).values([
      { id: ids.alice, subject: 'alice@lab' },
      { id: ids.mallory, subject: 'mallory@lab' },
    ] as any);
    await db.insert(sshHostBlocks).values({ id: randomUUID(), hostId: ids.hostBlocked, identityId: ids.alice, reason: 'blk05' } as any);

    // Baseline per-host rows for both hosts (fresh nextUpdate).
    await getSshHostKrlService().generate(ctx, ids.hostBlocked);
    await getSshHostKrlService().generate(ctx, ids.hostPlain);
  });

  afterAll(async () => {
    await getSshHostKrlService().flushEagerRegen();
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('revocation clamps next_update on ALL per-host rows and eagerly regenerates only blocked hosts', async () => {
    const freshBefore = await db.select().from(sshHostKrls).where(gt(sshHostKrls.nextUpdate, new Date()));
    expect(freshBefore.length).toBeGreaterThanOrEqual(2);
    const blockedCountBefore = await hostKrlCount(ids.hostBlocked);
    const plainCountBefore = await hostKrlCount(ids.hostPlain);

    await getSshKrlService().revokeBySerial(ctx, ids.caUser, '9001', 'blk05-serial');

    // Cheap invalidation: nothing stays fresh (the eager regen may already have
    // produced ONE new fresh row for the blocked host — tolerate it).
    await getSshHostKrlService().flushEagerRegen();
    expect(await hostKrlCount(ids.hostBlocked)).toBe(blockedCountBefore + 1); // eager regen
    expect(await hostKrlCount(ids.hostPlain)).toBe(plainCountBefore); // NOT regenerated (lazy backstop)
    const plainLatest = await getSshHostKrlService().getLatestRow(ctx, ids.hostPlain);
    expect(new Date(plainLatest.nextUpdate).getTime()).toBeLessThanOrEqual(Date.now()); // clamped

    // The eager row already carries the new revocation (latency bounded by the
    // pull interval, not the 1h nextUpdate backstop).
    const blockedLatest = await getSshHostKrlService().getLatestRow(ctx, ids.hostBlocked);
    const decoded = decodeKrl(Buffer.from(blockedLatest.krlBlob));
    const caUBlobHex = parseSshPublicKey((await db.select().from(sshCas).where(eq(sshCas.id, ids.caUser)))[0].opensshPublicKey).blob.toString('hex');
    expect(decoded.serialsByCaHex.get(caUBlobHex)).toContain(9001n);
  });

  it('every revocation entry point invalidates: revokeByCert, revokeByKeyFingerprint, user.revoke', async () => {
    const entryPoints: Array<() => Promise<unknown>> = [
      async () => {
        const c = certRow({ identityId: ids.mallory, serial: '7101', keyId: 'ep1' });
        await db.insert(sshCertificates).values(c as any);
        return getSshKrlService().revokeByCert(ctx, c.id, 'ep');
      },
      async () =>
        getSshKrlService().revokeByKeyFingerprint(
          ctx,
          ids.caUser,
          'SHA256:' + createHash('sha256').update('ep2').digest('base64').replace(/=+$/, '')
        ),
      async () => {
        const c = certRow({ identityId: ids.mallory, serial: '7103', keyId: 'ep3' });
        await db.insert(sshCertificates).values(c as any);
        return getSshUserService().revoke(ctx, c.id, 'ep');
      },
    ];
    for (const fire of entryPoints) {
      // Refresh the plain host's lineage so there IS something fresh to clamp.
      await getSshHostKrlService().generate(ctx, ids.hostPlain);
      const fresh = await getSshHostKrlService().getLatestRow(ctx, ids.hostPlain);
      expect(new Date(fresh.nextUpdate).getTime()).toBeGreaterThan(Date.now());
      await fire();
      const after = await getSshHostKrlService().getLatestRow(ctx, ids.hostPlain);
      expect(new Date(after.nextUpdate).getTime()).toBeLessThanOrEqual(Date.now());
      await getSshHostKrlService().flushEagerRegen();
    }
  });

  it('identity offboard coalesces invalidation (no O(certs × hosts) regen storm)', async () => {
    // Give alice several active certs, then offboard: the loop revokes each.
    const serials = ['8201', '8202', '8203', '8204', '8205'];
    await db.insert(sshCertificates).values(serials.map((s) => certRow({ identityId: ids.alice, serial: s, keyId: `off-${s}` })) as any);
    const before = await hostKrlCount(ids.hostBlocked);

    await getSshUserService().offboard(ctx, ids.alice, 'blk05-offboard');
    await getSshHostKrlService().flushEagerRegen();

    const after = await hostKrlCount(ids.hostBlocked);
    expect(after - before).toBeGreaterThanOrEqual(1);
    expect(after - before).toBeLessThanOrEqual(2); // coalesced, NOT 5
    // All five serials landed in the composed KRL regardless.
    const latest = await getSshHostKrlService().getLatestRow(ctx, ids.hostBlocked);
    const caUBlobHex = parseSshPublicKey((await db.select().from(sshCas).where(eq(sshCas.id, ids.caUser)))[0].opensshPublicKey).blob.toString('hex');
    const got = decodeKrl(Buffer.from(latest.krlBlob)).serialsByCaHex.get(caUBlobHex) ?? [];
    for (const s of serials) expect(got).toContain(BigInt(s));
    // Re-activate alice for the remaining tests.
    await db.update(sshIdentities).set({ status: 'active' }).where(eq(sshIdentities.id, ids.alice));
  });

  it('issuing a user cert to a blocked identity regenerates the affected host KRL asynchronously', async () => {
    const before = await hostKrlCount(ids.hostBlocked);
    const signed = await getSshCertService().sign(ctx, {
      caId: ids.caUser,
      sshPublicKey: alicePub,
      type: 'user',
      keyId: 'alice-fresh-key',
      principals: ['dev'],
      validForSeconds: 3600,
      identityId: ids.alice,
    });
    await vi.waitFor(async () => {
      expect(await hostKrlCount(ids.hostBlocked)).toBe(before + 1);
    }, { timeout: 3000 });
    const latest = await getSshHostKrlService().getLatestRow(ctx, ids.hostBlocked);
    const caUBlobHex = parseSshPublicKey((await db.select().from(sshCas).where(eq(sshCas.id, ids.caUser)))[0].opensshPublicKey).blob.toString('hex');
    expect(decodeKrl(Buffer.from(latest.krlBlob)).serialsByCaHex.get(caUBlobHex)).toContain(BigInt(signed.serial));
  });

  it('issuance to an UNblocked identity does not touch per-host lineages; regen failure never fails issuance', async () => {
    const before = await hostKrlCount(ids.hostBlocked);
    await getSshCertService().sign(ctx, {
      caId: ids.caUser,
      sshPublicKey: malloryPub,
      type: 'user',
      keyId: 'mallory-key',
      principals: ['dev'],
      validForSeconds: 3600,
      identityId: ids.mallory,
    });
    await getSshHostKrlService().flushEagerRegen();
    expect(await hostKrlCount(ids.hostBlocked)).toBe(before);

    // Regen failure path: issuance succeeds even when the trigger's generate
    // blows up (per-host signing failure persists unsigned = still non-fatal;
    // here we prove a hard generate failure cannot propagate).
    const spy = vi.spyOn(getSshHostKrlService(), 'onUserCertIssued').mockRejectedValueOnce(new Error('boom'));
    const ok = await getSshCertService().sign(ctx, {
      caId: ids.caUser,
      sshPublicKey: alicePub,
      type: 'user',
      keyId: 'alice-key-2',
      principals: ['dev'],
      validForSeconds: 3600,
      identityId: ids.alice,
    });
    expect(ok.serial).toBeDefined();
    spy.mockRestore();
    await getSshHostKrlService().flushEagerRegen();
  });

  it('block resolution ignores the caller-settable keyId (forged keyId cannot dodge or fake blocks)', async () => {
    // mallory forges keyId to impersonate alice; alice has a cert whose keyId
    // claims to be someone else. Only identity_id decides.
    const forged = certRow({ identityId: ids.mallory, serial: '9501', keyId: 'alice@lab' });
    const disguised = certRow({ identityId: ids.alice, serial: '9502', keyId: 'not-alice' });
    await db.insert(sshCertificates).values([forged, disguised] as any);

    const dto = await getSshHostKrlService().generate(ctx, ids.hostBlocked);
    expect(dto.blockCount).toBe(1);
    const latest = await getSshHostKrlService().getLatestRow(ctx, ids.hostBlocked);
    const caUBlobHex = parseSshPublicKey((await db.select().from(sshCas).where(eq(sshCas.id, ids.caUser)))[0].opensshPublicKey).blob.toString('hex');
    const serials = decodeKrl(Buffer.from(latest.krlBlob)).serialsByCaHex.get(caUBlobHex) ?? [];
    expect(serials).toContain(9502n); // alice's cert denied despite disguised keyId
    expect(serials).not.toContain(9501n); // mallory's forged keyId does NOT get denied
  });
});
