/**
 * BLK-03 (TASK-180) — SshHostKrlService unit tests. KMS signRaw is mocked
 * (deterministic; the signature path is proven end-to-end by BLK-11 with real
 * KMS). CA/user keys and certs are REAL ssh-keygen artifacts so composition is
 * cross-checked with `ssh-keygen -Q`, plus a structural decode of the blob for
 * the assertions -Q cannot see (expired serial excluded while the same
 * identity's fingerprint entry remains).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLog, sshCas, sshCertificates, sshRevocations, sshHosts, sshIdentities, sshHostBlocks, sshHostKrls, sshKrls } from '../db/schema.js';
import { parseSshPublicKey } from '../crypto/ssh/pubkey.js';
import { getSshHostKrlService } from './ssh-host-krl.service.js';
import { getSshKrlService } from './ssh-krl.service.js';

const { signRawMock } = vi.hoisted(() => ({
  signRawMock: vi.fn(async () => Buffer.from('detached-der-signature')),
}));
vi.mock('../kms/service.js', () => ({
  getKMSService: () => ({ signRaw: signRawMock }),
}));

const ctx = { db, ipAddress: null };
const keygen = (args: string[]) => execFileSync('ssh-keygen', args, { stdio: 'pipe' });

function isRevoked(krlPath: string, keyPath: string): boolean {
  const r = spawnSync('ssh-keygen', ['-Q', '-f', krlPath, keyPath], { encoding: 'utf8' });
  return r.status !== 0 && /REVOKED/i.test(r.stdout + r.stderr);
}

function fpOf(pubkeyPath: string): string {
  const blob = parseSshPublicKey(readFileSync(pubkeyPath, 'utf8')).blob;
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
}

import { decodeKrl } from '../test/krl-decode.js';

async function wipe() {
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshCertificates, sshHosts, sshIdentities, sshCas]) {
    await db.delete(t);
  }
  await db.delete(auditLog).where(eq(auditLog.operation, 'ssh.host_krl.generate'));
}

describe('BLK-03 SshHostKrlService', () => {
  let work: string;
  const svc = getSshHostKrlService();
  const ids = {
    caUserActive: randomUUID(),
    caUserRetired: randomUUID(),
    caHost: randomUUID(),
    host: randomUUID(),
    blocked: randomUUID(),
    other: randomUUID(),
  };
  let caBlobHex: Record<string, string>;

  const certRow = (o: {
    caId: string; certType: 'host' | 'user'; serial: string; identityId?: string; hostId?: string;
    fp: string; validBefore: Date; status?: string;
  }) => ({
    id: randomUUID(),
    caId: o.caId,
    certType: o.certType,
    identityId: o.identityId ?? null,
    hostId: o.hostId ?? null,
    serial: o.serial,
    keyId: `test-${o.serial}`,
    principals: '[]',
    validAfter: new Date(Date.now() - 3600_000),
    validBefore: o.validBefore,
    certOpenssh: 'unused',
    subjectPubkeyFingerprint: o.fp,
    kmsSigningKeyId: 'kms-unused',
    status: o.status ?? 'active',
  });

  beforeAll(async () => {
    await wipe();
    work = mkdtempSync(join(tmpdir(), 'blk03-'));
    // Three CA keys + subject keys. ecdsa CAs match production (ECDSA-P256).
    for (const n of ['caA', 'caB', 'caH']) keygen(['-t', 'ecdsa', '-b', '256', '-f', join(work, n), '-N', '', '-q']);
    for (const n of ['u1', 'u2', 'v', 'hk', 'w']) keygen(['-t', 'ed25519', '-f', join(work, n), '-N', '', '-q']);

    const caPub = (n: string) => readFileSync(join(work, `${n}.pub`), 'utf8').trim();
    caBlobHex = {
      caA: parseSshPublicKey(caPub('caA')).blob.toString('hex'),
      caB: parseSshPublicKey(caPub('caB')).blob.toString('hex'),
      caH: parseSshPublicKey(caPub('caH')).blob.toString('hex'),
    };

    const caRow = (id: string, type: 'user' | 'host', key: string, status: string) => ({
      id, caType: type, kmsKeyId: `kms-${key}`, kmsPublicKeyId: `kmspub-${key}`,
      opensshPublicKey: caPub(key), fingerprintSha256: fpOf(join(work, `${key}.pub`)), status,
    });
    await db.insert(sshCas).values([
      caRow(ids.caUserActive, 'user', 'caA', 'active'),
      caRow(ids.caUserRetired, 'user', 'caB', 'retired'),
      caRow(ids.caHost, 'host', 'caH', 'active'),
    ] as any);

    await db.insert(sshHosts).values({ id: ids.host, fqdn: 'y.lab.local', status: 'active' } as any);
    await db.insert(sshIdentities).values([
      { id: ids.blocked, subject: 'alice@lab.local' },
      { id: ids.other, subject: 'victor@lab.local' },
    ] as any);

    // Real signed certs so ssh-keygen -Q can arbitrate. ssh-keygen writes to
    // <key>-cert.pub; move each to a distinct name so signings don't clobber.
    const sign = (ca: string, key: string, out: string, serial: string, host = false) => {
      const args = ['-s', join(work, ca), '-I', out, '-z', serial, '-V', '-1h:+1w', '-n', host ? 'y.lab.local' : 'alice'];
      if (host) args.push('-h');
      keygen([...args, join(work, `${key}.pub`)]);
      renameSync(join(work, `${key}-cert.pub`), join(work, `${out}-cert.pub`));
    };
    sign('caA', 'u1', 'blocked-active', '201'); // blocked identity, active CA
    sign('caB', 'u1', 'blocked-retired', '301'); // blocked identity, RETIRED CA
    sign('caA', 'v', 'other-revoked', '101'); // unblocked identity, revoked (bonus fix)
    sign('caH', 'hk', 'host-revoked', '11', true); // revoked HOST cert (req #2)
    sign('caA', 'w', 'unrelated', '999'); // untouched control

    const future = new Date(Date.now() + 6 * 24 * 3600_000);
    const past = new Date(Date.now() - 24 * 3600_000);
    await db.insert(sshCertificates).values([
      certRow({ caId: ids.caUserActive, certType: 'user', serial: '201', identityId: ids.blocked, fp: fpOf(join(work, 'u1.pub')), validBefore: future }),
      certRow({ caId: ids.caUserRetired, certType: 'user', serial: '301', identityId: ids.blocked, fp: fpOf(join(work, 'u1.pub')), validBefore: future }),
      // EXPIRED cert of the blocked identity on a second key: serial must NOT
      // appear; the key's fingerprint MUST (every key ever certified).
      certRow({ caId: ids.caUserActive, certType: 'user', serial: '401', identityId: ids.blocked, fp: fpOf(join(work, 'u2.pub')), validBefore: past }),
      certRow({ caId: ids.caUserActive, certType: 'user', serial: '101', identityId: ids.other, fp: fpOf(join(work, 'v.pub')), validBefore: future, status: 'revoked' }),
      certRow({ caId: ids.caHost, certType: 'host', serial: '11', hostId: ids.host, fp: fpOf(join(work, 'hk.pub')), validBefore: future, status: 'revoked' }),
    ] as any);

    await db.insert(sshHostBlocks).values({ id: randomUUID(), hostId: ids.host, identityId: ids.blocked, reason: 'incident' } as any);
  });

  afterAll(async () => {
    await wipe();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('composes host-CA + user-CA revocation sets + resolved blocks (ssh-keygen -Q cross-check)', async () => {
    const dto = await svc.generate(ctx, ids.host);
    expect(dto.blockCount).toBe(1);
    expect(dto.hasSignature).toBe(true);

    const row = await svc.getLatestRow(ctx, ids.host);
    const krlPath = join(work, 'composed.krl');
    writeFileSync(krlPath, Buffer.from(row.krlBlob));

    expect(isRevoked(krlPath, join(work, 'blocked-active-cert.pub'))).toBe(true); // block serial, active CA
    expect(isRevoked(krlPath, join(work, 'blocked-retired-cert.pub'))).toBe(true); // block serial, RETIRED CA
    expect(isRevoked(krlPath, join(work, 'other-revoked-cert.pub'))).toBe(true); // user-CA union (bonus fix)
    expect(isRevoked(krlPath, join(work, 'host-revoked-cert.pub'))).toBe(true); // host-CA union (pinned req #2)
    expect(isRevoked(krlPath, join(work, 'u2.pub'))).toBe(true); // fingerprint of a key EVER certified
    expect(isRevoked(krlPath, join(work, 'unrelated-cert.pub'))).toBe(false); // control
    expect(isRevoked(krlPath, join(work, 'w.pub'))).toBe(false); // control raw key
  });

  it('scopes serials per issuing CA and excludes expired serials (structural decode)', async () => {
    const row = await svc.getLatestRow(ctx, ids.host);
    const { serialsByCaHex, hashes } = decodeKrl(Buffer.from(row.krlBlob));

    expect(serialsByCaHex.get(caBlobHex.caA)).toEqual([101n, 201n]); // sorted; NO expired 401
    expect(serialsByCaHex.get(caBlobHex.caB)).toEqual([301n]); // retired-CA group kept
    expect(serialsByCaHex.get(caBlobHex.caH)).toEqual([11n]); // host-CA group kept
    // fingerprints: u1 (deduped across two certs) + u2 (expired cert's key); NOT v/w.
    const fpHex = (k: string) =>
      createHash('sha256').update(parseSshPublicKey(readFileSync(join(work, `${k}.pub`), 'utf8')).blob).digest('hex');
    expect(new Set(hashes)).toEqual(new Set([fpHex('u1'), fpHex('u2')]));
    expect(row.revokedCount).toBe(4 + 2); // 4 serials + 2 hashes
    expect(row.blockCount).toBe(1);
  });

  it('allocates globally monotonic numbers across per-CA and per-host lineages, concurrently', async () => {
    const krlSvc = getSshKrlService();
    const perCaFirst = await krlSvc.generate(ctx, ids.caUserActive);
    const results = await Promise.all([
      svc.generate(ctx, ids.host),
      krlSvc.generate(ctx, ids.caHost),
      svc.generate(ctx, ids.host),
      krlSvc.generate(ctx, ids.caUserActive),
      svc.generate(ctx, ids.host),
    ]);
    const numbers = results.map((r) => r.krlNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(n).toBeGreaterThan(perCaFirst.krlNumber);
    // The first per-host number exceeds every per-CA number allocated before it
    // (cutover accept, pinned req #4).
    const firstPerHost = Math.min(...results.filter((_, i) => i % 2 === 0).map((r) => r.krlNumber));
    expect(firstPerHost).toBeGreaterThan(perCaFirst.krlNumber);
  });

  it('persists an unsigned row when signRaw fails (failure audited), then recovers signed', async () => {
    signRawMock.mockRejectedValueOnce(new Error('KMS unreachable'));
    const unsigned = await svc.generate(ctx, ids.host);
    expect(unsigned.hasSignature).toBe(false);
    const row = (await db.select().from(sshHostKrls).where(eq(sshHostKrls.id, unsigned.id)))[0] as any;
    expect(row.caSignature).toBeNull();

    const failAudit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.operation, 'ssh.host_krl.generate'), eq(auditLog.status, 'failure')))
      .orderBy(desc(auditLog.timestamp));
    expect(failAudit.length).toBeGreaterThan(0);
    expect(JSON.parse((failAudit[0] as any).details).signError).toMatch(/KMS unreachable/);

    const signed = await svc.generate(ctx, ids.host);
    expect(signed.hasSignature).toBe(true);
    expect(signed.krlNumber).toBeGreaterThan(unsigned.krlNumber);
    const okAudit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.operation, 'ssh.host_krl.generate'), eq(auditLog.status, 'success')));
    expect(okAudit.length).toBeGreaterThan(0);
    expect(JSON.parse((okAudit[okAudit.length - 1] as any).details).blockCount).toBe(1);
  });

  it('audits and throws for an unknown host', async () => {
    await expect(svc.generate(ctx, 'no-such-host')).rejects.toThrow(/not found/);
    const fail = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.operation, 'ssh.host_krl.generate'), eq(auditLog.entityId, 'no-such-host')));
    expect(fail).toHaveLength(1);
    expect((fail[0] as any).status).toBe('failure');
    expect(JSON.parse((fail[0] as any).details).error).toMatch(/not found/);
  });
});
