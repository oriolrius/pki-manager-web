/**
 * Typed X.509 key store errors and their API mapping (decision-018).
 *
 * The X.509 key store (`x509-store.ts`) turns every OpenBao Transit failure into one of these
 * errors before it leaves the store. The services wrap them (`CAOperationError`, ...) with the
 * original as `cause`; the REST and tRPC edges call `keyStoreErrorResponse`, which follows the
 * `cause` chain, and answer with a stable code:
 *
 * | Error                          | HTTP | Code                    |
 * |--------------------------------|------|-------------------------|
 * | `KeyStoreUnavailableError`     | 503  | `KEY_STORE_UNAVAILABLE` |
 * | `KeyStoreObjectNotFoundError`  | 409  | `KEY_MIGRATION_REQUIRED`|
 * | `KeyStoreConflictError`        | 409  | `KEY_STATE_CONFLICT`    |
 * | `KeyNotExportableError`        | 403  | `KEY_NOT_EXPORTABLE`    |
 * | `KeyExportDeniedError`         | 403  | `KEY_EXPORT_DENIED`     |
 *
 * The client message is fixed text. The reason (sealed, not initialized, token refused, down)
 * goes to the server log and to the admin diagnostics (`GET /api/v1/diagnostics/key-store`),
 * never to an API client: a caller only learns that it can retry later.
 */
import { logger } from '../lib/logger.js';
import { OpenBaoTransitConfigError, OpenBaoTransitError } from '../openbao/x509-transit.js';

export const KEY_MIGRATION_REQUIRED = 'KEY_MIGRATION_REQUIRED';

/** Seconds a client waits before it retries after a `KEY_STORE_UNAVAILABLE` answer. */
export const KEY_STORE_RETRY_AFTER_SECONDS = 30;

/** An id with no key store row: a Cosmian object that the migration has not moved yet. */
export class KeyStoreObjectNotFoundError extends Error {
  readonly code = KEY_MIGRATION_REQUIRED;
  constructor(readonly objectId: string) {
    super(`Key store object ${objectId} is not in the OpenBao key store; run the key migration`);
    this.name = 'KeyStoreObjectNotFoundError';
  }
}

/** A key store row that does not permit the operation, or an integrity check that failed. */
export class KeyStoreStateError extends Error {}

/** The object's state does not permit the operation (pending, revoked, destroyed, not active). */
export class KeyStoreConflictError extends KeyStoreStateError {
  readonly code = 'KEY_STATE_CONFLICT';
}

export class KeyNotExportableError extends Error {
  readonly code = 'KEY_NOT_EXPORTABLE';
  constructor() {
    super('The private key was created non-exportable in OpenBao and cannot be exported');
  }
}

/** OpenBao refused the export (token policy or key policy). */
export class KeyExportDeniedError extends Error {
  readonly code = 'KEY_EXPORT_DENIED';
  constructor(options?: { cause?: unknown }) {
    super('The key store refused to export this private key', options);
    this.name = 'KeyExportDeniedError';
  }
}

/** Why the key store cannot serve requests. For the server log and the admin diagnostics only. */
export type KeyStoreUnavailableReason = 'sealed' | 'uninitialized' | 'unauthorized' | 'unavailable' | 'not_configured';

export class KeyStoreUnavailableError extends Error {
  readonly code = 'KEY_STORE_UNAVAILABLE';
  constructor(readonly reason: KeyStoreUnavailableReason, options?: { cause?: unknown }) {
    super('The key store is unavailable; retry later', options);
    this.name = 'KeyStoreUnavailableError';
  }
}

export type KeyStoreOperation = 'create' | 'sign' | 'export' | 'destroy';

/**
 * Converts an OpenBao Transit failure of `operation` to a typed error. Other errors (response
 * checks, integrity failures) are returned unchanged: they stay internal errors (500).
 */
export function toKeyStoreError(error: unknown, operation: KeyStoreOperation): unknown {
  if (error instanceof OpenBaoTransitConfigError) {
    logger.error({ operation, reason: error.message }, 'OpenBao X.509 key store is not configured');
    return new KeyStoreUnavailableError('not_configured', { cause: error });
  }
  if (!(error instanceof OpenBaoTransitError)) return error;
  logger.warn({ operation, status: error.status, path: error.path, detail: error.detail }, 'OpenBao X.509 request failed');
  const { status } = error;
  if (status === 0) return new KeyStoreUnavailableError(error.path === 'token' ? 'unauthorized' : 'unavailable', { cause: error });
  if (status === 501) return new KeyStoreUnavailableError('uninitialized', { cause: error });
  if (status === 503) return new KeyStoreUnavailableError(/sealed/i.test(error.detail) ? 'sealed' : 'unavailable', { cause: error });
  if (status === 429 || status === 502 || status === 504) return new KeyStoreUnavailableError('unavailable', { cause: error });
  if (operation === 'export' && (status === 400 || status === 403)) return new KeyExportDeniedError({ cause: error });
  // The backend token does not have the permission: an operator problem, not the caller's.
  if (status === 403) return new KeyStoreUnavailableError('unauthorized', { cause: error });
  return error;
}

export interface KeyStoreErrorResponse {
  status: 403 | 409 | 503;
  code: string;
  message: string;
  /** Set for 503: the value of the `Retry-After` header. */
  retryAfterSeconds?: number;
}

/** Status, code and safe message of a key store error anywhere in the `cause` chain; else null. */
export function keyStoreErrorResponse(error: unknown): KeyStoreErrorResponse | null {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof KeyStoreUnavailableError) {
      return { status: 503, code: current.code, message: current.message, retryAfterSeconds: KEY_STORE_RETRY_AFTER_SECONDS };
    }
    if (current instanceof KeyStoreObjectNotFoundError) {
      return { status: 409, code: current.code, message: 'The key of this object is not in the OpenBao key store yet; run the key migration' };
    }
    if (current instanceof KeyStoreConflictError) return { status: 409, code: current.code, message: current.message };
    if (current instanceof KeyNotExportableError) return { status: 403, code: current.code, message: current.message };
    if (current instanceof KeyExportDeniedError) return { status: 403, code: current.code, message: current.message };
    // An OpenBao error that no store method converted (for example a raw client call).
    if (current instanceof OpenBaoTransitError || current instanceof OpenBaoTransitConfigError) {
      const converted = toKeyStoreError(current, 'sign');
      return converted === current ? null : keyStoreErrorResponse(converted);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** True when the key store is unavailable as a whole (not a problem of one object). */
export function isKeyStoreUnavailable(error: unknown): boolean {
  return keyStoreErrorResponse(error)?.status === 503;
}

/**
 * The key creation failed before OpenBao could create the key (the first read failed, or the
 * create request was refused with an answer). False when the outcome is unknown, for example a
 * transport error after the create request was sent.
 */
export function keyCreationNotStarted(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof OpenBaoTransitError) return current.keyNotCreated === true;
    if (current instanceof OpenBaoTransitConfigError) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
