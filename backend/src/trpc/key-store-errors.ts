import { TRPCError } from '@trpc/server';
import { keyStoreErrorResponse } from '../keystore/errors.js';

const TRPC_CODE = { 403: 'FORBIDDEN', 409: 'CONFLICT', 503: 'SERVICE_UNAVAILABLE' } as const;

/**
 * Cause of a mapped key store TRPCError. Its `appCode` (KEY_STORE_UNAVAILABLE, ...) goes to the
 * client as `error.data.appCode`; its message differs from the TRPCError message, so the
 * production error formatter keeps the safe message.
 */
export class KeyStoreTrpcCause extends Error {
  constructor(readonly appCode: string, readonly retryAfterSeconds?: number) {
    super(`key store error ${appCode}`);
    this.name = 'KeyStoreTrpcCause';
  }
}

/**
 * Throws a key store error found in `error` or its `cause` chain as a TRPCError: 503
 * SERVICE_UNAVAILABLE, 409 CONFLICT or 403 FORBIDDEN, with the safe message of
 * `keystore/errors.ts`. Returns when `error` is not a key store error.
 */
export function throwIfKeyStoreError(error: unknown): void {
  if (error instanceof TRPCError && error.cause instanceof KeyStoreTrpcCause) throw error;
  const mapped = keyStoreErrorResponse(error);
  if (!mapped) return;
  throw new TRPCError({ code: TRPC_CODE[mapped.status], message: mapped.message, cause: new KeyStoreTrpcCause(mapped.code, mapped.retryAfterSeconds) });
}

/** tRPC `responseMeta`: `Retry-After` on a response that carries a key store outage. */
export function keyStoreResponseMeta({ errors }: { errors: TRPCError[] }): { headers?: Record<string, string> } {
  const retry = errors.map((e) => e.cause).find((c): c is KeyStoreTrpcCause => c instanceof KeyStoreTrpcCause && !!c.retryAfterSeconds);
  return retry ? { headers: { 'retry-after': String(retry.retryAfterSeconds) } } : {};
}
