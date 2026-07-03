/**
 * BLK-08 (TASK-185) — ssh.block.* API surface on BOTH transports (tRPC caller
 * + REST inject), sharing one Zod source. Covers the SSH-34 fail-closed
 * posture, the block/unblock round-trip with audit THROUGH the API path, the
 * shared-fingerprint warning passthrough, and the read model (host access
 * join, identity tuples with state, fleet distribution). KMS mocked.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { appRouter } from '../router.js';
import { sshRoutes } from '../../rest/routes/ssh.routes.js';
import { db } from '../../db/client.js';
import { auditLog, sshCas, sshCertificates, sshRevocations, sshHosts, sshIdentities, sshHostBlocks, sshHostKrls, sshKrls, sshPrincipals, sshUserPrincipals, sshHostPrincipalMaps } from '../../db/schema.js';
import { parseSshPublicKey } from '../../crypto/ssh/pubkey.js';

const { signRawMock } = vi.hoisted(() => ({
  signRawMock: vi.fn(async () => Buffer.from('detached-der-signature')),
}));
vi.mock('../../kms/service.js', () => ({
  getKMSService: () => ({ signRaw: signRawMock }),
}));

const makeCtx = () => ({ req: { ip: '127.0.0.1' }, res: {}, db, user: undefined });
const caller = () => appRouter.createCaller(makeCtx() as any);

async function wipe() {
  for (const t of [sshHostKrls, sshHostBlocks, sshKrls, sshRevocations, sshHostPrincipalMaps, sshUserPrincipals, sshCertificates, sshHosts, sshIdentities, sshPrincipals, sshCas]) {
    await db.delete(t);
  }
  await db.delete(auditLog).where(eq(auditLog.operation, 'ssh.host.block'));
  await db.delete(auditLog).where(eq(auditLog.operation, 'ssh.host.unblock'));
}

describe('BLK-08 SSH-34 fail-closed (OIDC disabled, no opt-in)', () => {
  let rest: FastifyInstance;

  beforeAll(async () => {
    delete process.env.ALLOW_UNAUTHENTICATED_SSH_CA;
    rest = Fastify();
    await rest.register(sshRoutes, { prefix: '/api/v1/ssh' });
    await rest.ready();
  });
  afterAll(async () => {
    await rest?.close();
  });

  it('tRPC: block, unblock, and the read model all refuse', async () => {
    await expect(caller().ssh.block.block({ hostId: 'h', identityId: 'i' })).rejects.toThrow(/require OIDC|FORBIDDEN/i);
    await expect(caller().ssh.block.unblock({ hostId: 'h', identityId: 'i' })).rejects.toThrow(/require OIDC|FORBIDDEN/i);
    await expect(caller().ssh.host.access({ id: 'h' })).rejects.toThrow(/require OIDC|FORBIDDEN/i);
    await expect(caller().ssh.block.fleetDistribution()).rejects.toThrow(/require OIDC|FORBIDDEN/i);
  });

  it('REST twins refuse with 403 FORBIDDEN', async () => {
    const post = await rest.inject({ method: 'POST', url: '/api/v1/ssh/blocks', payload: { hostId: 'h', identityId: 'i' } });
    expect(post.statusCode).toBe(403);
    expect(JSON.parse(post.body).error.code).toBe('FORBIDDEN');
    expect((await rest.inject({ method: 'GET', url: '/api/v1/ssh/blocks/fleet' })).statusCode).toBe(403);
    expect((await rest.inject({ method: 'GET', url: '/api/v1/ssh/hosts/h/access' })).statusCode).toBe(403);
  });
});

describe('BLK-08 block API (dev opt-in)', () => {
  let rest: FastifyInstance;
  let work: string;
  const ids = { caUser: randomUUID(), caHost: randomUUID(), host: randomUUID(), alice: randomUUID(), carol: randomUUID(), role: randomUUID() };
  let sharedFp: string;

  beforeAll(async () => {
    process.env.ALLOW_UNAUTHENTICATED_SSH_CA = 'true';
    await wipe();
    work = mkdtempSync(join(tmpdir(), 'blk08-'));
    for (const n of ['caU', 'caH']) execFileSync('ssh-keygen', ['-t', 'ecdsa', '-b', '256', '-f', join(work, n), '-N', '', '-q']);
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', join(work, 'shared'), '-N', '', '-q']);
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
    await db.insert(sshHosts).values({
      id: ids.host,
      fqdn: 'api.lab.local',
      opensshHostPubkey: 'ecdsa-sha2-nistp256 AAAA...',
      hostKeyAlgorithm: 'ecdsa-sha2-nistp256',
      status: 'active',
    } as any);
    await db.insert(sshIdentities).values([
      { id: ids.alice, subject: 'alice@lab' },
      { id: ids.carol, subject: 'carol@lab' },
    ] as any);
    // Entitlement chain: alice holds role 'admins' which maps to root on the host.
    await db.insert(sshPrincipals).values({ id: ids.role, name: 'admins' } as any);
    await db.insert(sshUserPrincipals).values({ id: randomUUID(), identityId: ids.alice, principalId: ids.role } as any);
    await db.insert(sshHostPrincipalMaps).values({ id: randomUUID(), hostId: ids.host, principalId: ids.role, localAccount: 'root' } as any);
    // Shared key: alice + carol certified for the same pubkey (over-block warning).
    const cert = (identityId: string, serial: string) => ({
      id: randomUUID(), caId: ids.caUser, certType: 'user', identityId, serial, keyId: `k-${serial}`,
      principals: '[]', validAfter: new Date(Date.now() - 3600_000), validBefore: new Date(Date.now() + 6 * 24 * 3600_000),
      certOpenssh: 'unused', subjectPubkeyFingerprint: sharedFp, kmsSigningKeyId: 'kms', status: 'active',
    });
    await db.insert(sshCertificates).values([cert(ids.alice, '1'), cert(ids.carol, '2')] as any);

    rest = Fastify();
    await rest.register(sshRoutes, { prefix: '/api/v1/ssh' });
    await rest.ready();
  });

  afterAll(async () => {
    await rest?.close();
    await wipe();
    delete process.env.ALLOW_UNAUTHENTICATED_SSH_CA;
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('tRPC block → unblock round-trip with warnings, fresh KRL, and audit through the API path', async () => {
    const res = await caller().ssh.block.block({ hostId: ids.host, identityId: ids.alice, reason: 'api test' });
    expect(res!.block.status).toBe('active');
    expect(res!.krl?.blockCount).toBe(1);
    expect(res!.warnings.sharedKeyCollisions).toEqual([{ identityId: ids.carol, subject: 'carol@lab', fingerprint: sharedFp }]);

    const audits = await db.select().from(auditLog).where(and(eq(auditLog.operation, 'ssh.host.block'), eq(auditLog.status, 'success')));
    expect(audits.length).toBe(1);
    expect(JSON.parse((audits[0] as any).details)).toMatchObject({ identityId: ids.alice, hostId: ids.host, reason: 'api test' });

    const lifted = await caller().ssh.block.unblock({ hostId: ids.host, identityId: ids.alice });
    expect(lifted!.block.status).toBe('lifted');
  });

  it('REST twins share the Zod source: validation parity + same round-trip', async () => {
    const bad = await rest.inject({ method: 'POST', url: '/api/v1/ssh/blocks', payload: { hostId: '' } });
    expect(bad.statusCode).toBe(400);

    const ok = await rest.inject({
      method: 'POST',
      url: '/api/v1/ssh/blocks',
      payload: { hostId: ids.host, identityId: ids.alice, reason: 'rest' },
    });
    expect(ok.statusCode).toBe(200);
    const body = JSON.parse(ok.body);
    expect(body.block.status).toBe('active');
    expect(body.warnings.sharedKeyCollisions).toHaveLength(1);

    const un = await rest.inject({ method: 'POST', url: '/api/v1/ssh/blocks/unblock', payload: { hostId: ids.host, identityId: ids.alice } });
    expect(un.statusCode).toBe(200);
    expect(JSON.parse(un.body).block.status).toBe('lifted');
  });

  it('ssh.host.access returns identity / via-roles / local-accounts + blocked rows with state, in one call', async () => {
    await caller().ssh.block.block({ hostId: ids.host, identityId: ids.carol, reason: 'not entitled but blocked' });
    const access = await caller().ssh.host.access({ id: ids.host });
    expect(access!.fqdn).toBe('api.lab.local');
    expect(['effective', 'pending', 'lifting']).toContain(access!.state.state);

    const alice = access!.entries.find((e: any) => e.subject === 'alice@lab')!;
    expect(alice.viaRoles).toEqual(['admins']);
    expect(alice.localAccounts).toEqual(['root']);
    expect(alice.blocked).toBe(false);

    const carol = access!.entries.find((e: any) => e.subject === 'carol@lab')!;
    expect(carol.blocked).toBe(true); // pre-emptive: not entitled, still listed
    expect(carol.viaRoles).toEqual([]);
    expect(carol.block?.reason).toBe('not entitled but blocked');
  });

  it('identity tuples + fleet distribution return per-host state without N+1', async () => {
    const tuples = await caller().ssh.block.listForIdentity({ id: ids.carol });
    expect(tuples).toHaveLength(1);
    expect(tuples[0]).toMatchObject({ hostId: ids.host, fqdn: 'api.lab.local' });
    expect(tuples[0].state.state).toBeDefined();

    const fleet = await caller().ssh.block.fleetDistribution();
    const row = fleet!.find((r: any) => r.hostId === ids.host)!;
    expect(row.blockCount).toBe(1); // carol active; alice lifted
    expect(row.state.state).toBeDefined();
    expect(row.krlNumber).toBeGreaterThan(0);

    const restFleet = await rest.inject({ method: 'GET', url: '/api/v1/ssh/blocks/fleet' });
    expect(restFleet.statusCode).toBe(200);
    expect(JSON.parse(restFleet.body).find((r: any) => r.hostId === ids.host).blockCount).toBe(1);
  });
});
