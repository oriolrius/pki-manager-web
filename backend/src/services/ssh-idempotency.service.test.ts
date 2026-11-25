/**
 * Issue #52 — the SSH Idempotency-Key cache is scoped to the fleet token and
 * bound to the endpoint + request. No KMS: the cache logic works on the DB only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sshIdempotency } from '../db/schema.js';
import {
  beginIdempotent,
  completeIdempotent,
  releaseIdempotent,
  readIdempotencyKey,
  requestFingerprint,
} from './ssh-idempotency.service.js';

const ctx = { db, ipAddress: null };
const future = () => new Date(Date.now() + 3600_000);
const fpA = requestFingerprint('sign-host', { fqdn: 'a.lab', opensshHostPubkey: 'k' });

async function reserveAndComplete(tokenId: string, key: string, response: unknown, fingerprint = fpA) {
  const b = await beginIdempotent(ctx, { tokenId, key, op: 'sign-host', fingerprint });
  expect(b.kind).toBe('reserved');
  if (b.kind !== 'reserved') throw new Error('not reserved');
  await completeIdempotent(ctx, b, `cert-${tokenId}`, response, future());
}

describe('ssh idempotency cache (issue #52)', () => {
  beforeEach(async () => {
    await db.delete(sshIdempotency);
  });

  it('two tokens with the same key get independent entries (no cross-token replay)', async () => {
    await reserveAndComplete('token-a', 'same-key', { serial: 'A' });
    // Token B, same key, same request: it must NOT get token A's response.
    const b = await beginIdempotent(ctx, { tokenId: 'token-b', key: 'same-key', op: 'sign-host', fingerprint: fpA });
    expect(b.kind).toBe('reserved');
    if (b.kind !== 'reserved') return;
    await completeIdempotent(ctx, b, 'cert-b', { serial: 'B' }, future());

    const ra = await beginIdempotent(ctx, { tokenId: 'token-a', key: 'same-key', op: 'sign-host', fingerprint: fpA });
    const rb = await beginIdempotent(ctx, { tokenId: 'token-b', key: 'same-key', op: 'sign-host', fingerprint: fpA });
    expect(ra).toEqual({ kind: 'replay', response: { serial: 'A' } });
    expect(rb).toEqual({ kind: 'replay', response: { serial: 'B' } });
    expect((await db.select().from(sshIdempotency)).length).toBe(2);
  });

  it('the same token and key replay the cached response', async () => {
    await reserveAndComplete('token-a', 'k1', { serial: 'A1' });
    const r = await beginIdempotent(ctx, { tokenId: 'token-a', key: 'k1', op: 'sign-host', fingerprint: fpA });
    expect(r).toEqual({ kind: 'replay', response: { serial: 'A1' } });
  });

  it('refuses a key reused for another endpoint or another request (422)', async () => {
    await reserveAndComplete('token-a', 'k2', { serial: 'A2' });
    const otherOp = await beginIdempotent(ctx, { tokenId: 'token-a', key: 'k2', op: 'sign-user', fingerprint: fpA });
    expect(otherOp).toMatchObject({ kind: 'error', status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
    const otherReq = await beginIdempotent(ctx, {
      tokenId: 'token-a', key: 'k2', op: 'sign-host',
      fingerprint: requestFingerprint('sign-host', { fqdn: 'b.lab', opensshHostPubkey: 'k' }),
    });
    expect(otherReq).toMatchObject({ kind: 'error', status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('a concurrent request for an in-flight key gets 409; a released key can run again', async () => {
    const first = await beginIdempotent(ctx, { tokenId: 'token-a', key: 'k3', op: 'sign-host', fingerprint: fpA });
    expect(first.kind).toBe('reserved');
    const second = await beginIdempotent(ctx, { tokenId: 'token-a', key: 'k3', op: 'sign-host', fingerprint: fpA });
    expect(second).toMatchObject({ kind: 'error', status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' });
    if (first.kind !== 'reserved') return;
    await releaseIdempotent(ctx, first); // the first request failed
    const retry = await beginIdempotent(ctx, { tokenId: 'token-a', key: 'k3', op: 'sign-host', fingerprint: fpA });
    expect(retry.kind).toBe('reserved');
  });

  it('release never drops a completed entry', async () => {
    await reserveAndComplete('token-a', 'k4', { serial: 'A4' });
    await releaseIdempotent(ctx, { tokenId: 'token-a', key: 'k4' });
    const r = await beginIdempotent(ctx, { tokenId: 'token-a', key: 'k4', op: 'sign-host', fingerprint: fpA });
    expect(r.kind).toBe('replay');
  });

  it('an entry whose certificate expired is purged, so a retry mints again', async () => {
    await reserveAndComplete('token-a', 'k5', { serial: 'A5' });
    await db
      .update(sshIdempotency)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(and(eq(sshIdempotency.tokenId, 'token-a'), eq(sshIdempotency.key, 'k5')));
    const r = await beginIdempotent(ctx, { tokenId: 'token-a', key: 'k5', op: 'sign-host', fingerprint: fpA });
    expect(r.kind).toBe('reserved');
  });

  it('validates the Idempotency-Key header', async () => {
    expect(readIdempotencyKey({})).toBeUndefined();
    expect(readIdempotencyKey({ 'idempotency-key': 'host-SHA256:abc+/=' })).toBe('host-SHA256:abc+/=');
    expect(readIdempotencyKey({ 'idempotency-key': '' })).toBeNull();
    expect(readIdempotencyKey({ 'idempotency-key': 'has space' })).toBeNull();
    expect(readIdempotencyKey({ 'idempotency-key': 'x'.repeat(256) })).toBeNull();
    expect(readIdempotencyKey({ 'idempotency-key': ['a', 'b'] })).toBeNull();
    const r = await beginIdempotent(ctx, { tokenId: 't', key: null, op: 'sign-host', fingerprint: fpA });
    expect(r).toMatchObject({ kind: 'error', status: 400 });
    expect(await beginIdempotent(ctx, { tokenId: 't', key: undefined, op: 'sign-host', fingerprint: fpA })).toEqual({ kind: 'none' });
  });
});
