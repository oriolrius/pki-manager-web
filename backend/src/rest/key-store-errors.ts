import type { FastifyReply } from 'fastify';
import { keyStoreErrorResponse } from '../keystore/errors.js';

/**
 * When `error` (or its `cause` chain) is a key store error, sets the status (and `Retry-After`
 * for 503) on `reply` and returns the standard error body; otherwise returns null.
 * Codes: KEY_STORE_UNAVAILABLE (503), KEY_MIGRATION_REQUIRED and KEY_STATE_CONFLICT (409),
 * KEY_NOT_EXPORTABLE and KEY_EXPORT_DENIED (403). See `keystore/errors.ts`.
 */
export function keyStoreErrorBody(reply: FastifyReply, error: unknown): { error: { code: string; message: string } } | null {
  const mapped = keyStoreErrorResponse(error);
  if (!mapped) return null;
  if (mapped.retryAfterSeconds) reply.header('Retry-After', String(mapped.retryAfterSeconds));
  reply.code(mapped.status);
  return { error: { code: mapped.code, message: mapped.message } };
}
