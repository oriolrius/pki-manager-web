/**
 * Issue #52 — route-level regression: a fleet token never receives the response
 * that the Idempotency-Key cache holds for ANOTHER token. No KMS: the cached row
 * of token A is seeded directly, and token B's own issuance fails without a KMS
 * (that failure is the proof that B did not get A's certificate).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { registerSshExternalRoutes } from './ssh-external.routes.js';
import { db } from '../../db/client.js';
import { sshCas, sshHosts, sshCertificates, sshKrls, sshRevocations, sshFleetTokens, sshIdempotency } from '../../db/schema.js';
import { getSshFleetTokenService } from '../../services/ssh-fleet-token.service.js';
import { requestFingerprint } from '../../services/ssh-idempotency.service.js';

const ctx = { db, ipAddress: null };
const KEY = 'web1-SHA256:shared-key';
const PUB = 'ecdsa-sha2-nistp256 AAAA-not-a-real-key web1';
const body = { fqdn: 'web1.idem.lab', addresses: ['10.0.0.1'], opensshHostPubkey: PUB };
const cachedForA = { hostId: 'host-of-token-a', certOpenssh: 'cert-of-token-a', serial: '42', keyId: 'a', validBefore: '2099-01-01T00:00:00.000Z' };

async function wipe() {
  for (const t of [sshIdempotency, sshFleetTokens, sshKrls, sshRevocations, sshCertificates, sshHosts, sshCas]) {
    await db.delete(t);
  }
}

describe('SSH external Idempotency-Key is scoped to the fleet token (issue #52)', () => {
  let app: FastifyInstance;
  let tokenA: { token: string; id: string };
  let tokenB: { token: string; id: string };

  beforeAll(async () => {
    await wipe();
    app = Fastify();
    registerSshExternalRoutes(app);
    await app.ready();

    const hostCaId = randomUUID();
    await db.insert(sshCas).values({
      id: hostCaId, caType: 'host', kmsKeyId: 'k', kmsPublicKeyId: 'kp',
      opensshPublicKey: 'ecdsa-sha2-nistp256 AAAA', fingerprintSha256: 'SHA256:idem', status: 'active',
    } as any);
    const a = await getSshFleetTokenService().mint(ctx, { name: 'tenant-a', hostCaId, opSet: ['sign-host'] });
    const b = await getSshFleetTokenService().mint(ctx, { name: 'tenant-b', hostCaId, opSet: ['sign-host'] });
    tokenA = { token: a.token, id: a.record.id };
    tokenB = { token: b.token, id: b.record.id };

    // Token A already signed with KEY: its response is in the cache.
    await db.insert(sshIdempotency).values({
      tokenId: tokenA.id,
      key: KEY,
      op: 'sign-host',
      requestHash: requestFingerprint('sign-host', { fqdn: body.fqdn, opensshHostPubkey: PUB, validForSeconds: null, keyId: null }),
      certId: 'cert-a',
      response: JSON.stringify(cachedForA),
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
  });

  afterAll(async () => {
    await app?.close();
    await wipe();
  });

  const signHost = (token: string, payload: unknown, key = KEY) =>
    app.inject({ method: 'POST', url: '/api/v1/external/ssh/sign-host', headers: { authorization: `Bearer ${token}`, 'idempotency-key': key }, payload: payload as any });

  it('token B with the same key does not receive token A\'s cached certificate', async () => {
    const r = await signHost(tokenB.token, body);
    expect(r.body).not.toContain('cert-of-token-a');
    expect(r.json().hostId).not.toBe('host-of-token-a');
    // B's own issuance failed (no KMS): its reservation is released, A's entry stays.
    expect(r.statusCode).toBe(400);
    const rowsB = await db.select().from(sshIdempotency).where(eq(sshIdempotency.tokenId, tokenB.id));
    expect(rowsB).toHaveLength(0);
    const rowA = await db.select().from(sshIdempotency).where(and(eq(sshIdempotency.tokenId, tokenA.id), eq(sshIdempotency.key, KEY)));
    expect(rowA).toHaveLength(1);
  });

  it('token A with the same key and request replays its own cached response', async () => {
    const r = await signHost(tokenA.token, body);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(cachedForA);
  });

  it('token A replays even when only the live addresses changed', async () => {
    const r = await signHost(tokenA.token, { ...body, addresses: ['10.0.0.1', '172.17.0.1'] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(cachedForA);
  });

  it('token A reusing the key for another host gets 422, not the cached certificate', async () => {
    const r = await signHost(tokenA.token, { ...body, fqdn: 'other.idem.lab' });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(r.body).not.toContain('cert-of-token-a');
  });

  it('rejects an invalid Idempotency-Key with 400', async () => {
    const r = await signHost(tokenA.token, body, 'x'.repeat(300));
    expect(r.statusCode).toBe(400);
  });
});
