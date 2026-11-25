/**
 * Idempotency-Key cache for the fleet-token SSH signing API (SSH-19, issue #52).
 *
 * Rules:
 * - Scope: a cached response belongs to ONE fleet token. The primary key is
 *   (token_id, key), so the same key sent by two tokens gives two independent
 *   entries; a token can never replay another token's certificate.
 * - Binding: an entry records the endpoint (`op`) and a hash of the request
 *   identity fields. The same key with another endpoint or another request is
 *   refused (422 IDEMPOTENCY_KEY_REUSED), not replayed.
 * - Concurrency: `begin()` reserves the key with an atomic INSERT before the
 *   certificate is minted. A second request for the same (token, key) while
 *   the first is in flight gets 409 IDEMPOTENCY_IN_PROGRESS. A failed request
 *   releases its reservation, so the client can retry.
 * - Expiry: an entry lives until the cached certificate's validBefore (a
 *   reservation for PENDING_SECONDS). Expired entries are purged, so a retry
 *   after expiry mints a fresh certificate. Revoking a certificate also drops
 *   its entry (ssh-krl.service).
 */
import { createHash } from 'node:crypto';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { sshIdempotency } from '../db/schema.js';
import type { ServiceContext } from './types.js';

export type SshIdempotencyOp = 'sign-host' | 'sign-user';

/** A reservation is dropped after this time if its request never completes (crash). */
export const PENDING_SECONDS = 300;

/** Printable ASCII without spaces, 1..255 characters. */
const KEY_RE = /^[\x21-\x7e]{1,255}$/;

export type IdempotencyBegin =
  | { kind: 'none' }
  | { kind: 'reserved'; tokenId: string; key: string }
  | { kind: 'replay'; response: unknown }
  | { kind: 'error'; status: 400 | 409 | 422; code: string; message: string };

/** Hash of the request identity: the same key must carry the same request. */
export function requestFingerprint(op: SshIdempotencyOp, fields: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify([op, fields])).digest('hex');
}

/** Read the Idempotency-Key header. undefined = absent; null = present but invalid. */
export function readIdempotencyKey(headers: Record<string, unknown>): string | undefined | null {
  const raw = headers['idempotency-key'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !KEY_RE.test(raw)) return null;
  return raw;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function beginIdempotent(
  ctx: ServiceContext,
  params: { tokenId: string; key: string | undefined | null; op: SshIdempotencyOp; fingerprint: string }
): Promise<IdempotencyBegin> {
  const { tokenId, key, op, fingerprint } = params;
  if (key === undefined) return { kind: 'none' };
  if (key === null) {
    return { kind: 'error', status: 400, code: 'VALIDATION_ERROR', message: 'Idempotency-Key must be 1 to 255 printable ASCII characters without spaces' };
  }

  // Purge expired entries and abandoned reservations first.
  await ctx.db.delete(sshIdempotency).where(lt(sshIdempotency.expiresAt, new Date()));

  // Atomic reservation: only one request for (token, key) inserts the row.
  const res = ctx.db
    .insert(sshIdempotency)
    .values({
      tokenId,
      key,
      op,
      requestHash: fingerprint,
      response: null,
      expiresAt: new Date((nowSeconds() + PENDING_SECONDS) * 1000),
    })
    .onConflictDoNothing()
    .run();
  if (res.changes === 1) return { kind: 'reserved', tokenId, key };

  const row = (await ctx.db
    .select()
    .from(sshIdempotency)
    .where(and(eq(sshIdempotency.tokenId, tokenId), eq(sshIdempotency.key, key)))
    .limit(1))[0];
  if (row && (row.op !== op || row.requestHash !== fingerprint)) {
    return { kind: 'error', status: 422, code: 'IDEMPOTENCY_KEY_REUSED', message: 'this Idempotency-Key was used for a different request; use a new key' };
  }
  if (!row || row.response === null) {
    return { kind: 'error', status: 409, code: 'IDEMPOTENCY_IN_PROGRESS', message: 'a request with this Idempotency-Key is in progress; retry later' };
  }
  return { kind: 'replay', response: JSON.parse(row.response) };
}

/** Store the response of a reserved request; it replays until `expiresAt`. */
export async function completeIdempotent(
  ctx: ServiceContext,
  r: { tokenId: string; key: string },
  certId: string,
  response: unknown,
  expiresAt: Date
): Promise<void> {
  await ctx.db
    .update(sshIdempotency)
    .set({ certId, response: JSON.stringify(response), expiresAt })
    .where(and(eq(sshIdempotency.tokenId, r.tokenId), eq(sshIdempotency.key, r.key)));
}

/** Drop the reservation of a failed request so a retry can run. */
export async function releaseIdempotent(ctx: ServiceContext, r: { tokenId: string; key: string }): Promise<void> {
  await ctx.db
    .delete(sshIdempotency)
    .where(and(eq(sshIdempotency.tokenId, r.tokenId), eq(sshIdempotency.key, r.key), isNull(sshIdempotency.response)));
}
