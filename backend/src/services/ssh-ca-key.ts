/**
 * SSH CA key operations (decision-018 cutover): the only path from the SSH
 * services to the key store. Every SSH CA key is an OpenBao Transit key
 * (`openbao/ssh-transit.ts`); there is no Cosmian path at runtime.
 *
 * - `createSshCaKey` makes the key of a new CA or of a rotation successor.
 * - `adoptSshCaKey` checks an existing Transit key for `import` (a key that an
 *   operator or the migration put in the SSH mount).
 * - `signWithSshCa` signs certificates, KRLs and probes. It pins the key to the
 *   public key recorded for the CA (`ssh_cas.openssh_public_key`): the trust
 *   anchors that the fleet has must never change under an existing CA.
 *
 * A CA whose key id is not an OpenBao reference is a legacy Cosmian CA: it gets
 * `SshCaKeyMigrationRequiredError` and never a silently generated replacement.
 */
import type { KeyObject } from 'node:crypto';
import { createPublicKey } from 'node:crypto';
import { db as defaultDb } from '../db/client.js';
import { createAuditLog } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { parseSshPublicKey, spkiToOpenSshEcdsa } from '../crypto/ssh/pubkey.js';
import {
  OpenBaoConfigError, OpenBaoError, OpenBaoResponseError, OpenBaoSshTransit, formatSshKeyRef, getOpenBaoSshTransit,
  isOpenBaoSshKeyRef, parseSshKeyRef, type SshCaKeyRef,
} from '../openbao/ssh-transit.js';
import type { ServiceContext } from './types.js';

/** The CA's key is still a Cosmian KMS id: it needs the OpenBao key migration. */
export class SshCaKeyMigrationRequiredError extends Error {
  readonly statusCode = 409;
  readonly code = 'SSH_CA_KEY_MIGRATION_REQUIRED';
  constructor(caId?: string) {
    super(`SSH CA${caId ? ` ${caId}` : ''} key is in the legacy Cosmian KMS; run the OpenBao key migration`);
    this.name = 'SshCaKeyMigrationRequiredError';
  }
}

/** The key store refused, failed or is not reachable. The detail goes to the server log only. */
export class SshCaKeyStoreError extends Error {
  constructor(readonly statusCode: 502 | 503, readonly code: 'SSH_KEYSTORE_UNAVAILABLE' | 'SSH_KEY_OPERATION_FAILED', message: string) {
    super(message);
    this.name = 'SshCaKeyStoreError';
  }
}

/** Another CA already uses this key (any zone): one key is one trust anchor in one zone. */
export class SshCaKeyExistsError extends Error {
  constructor() {
    super('this SSH CA key is already used by another SSH CA');
    this.name = 'SshCaKeyExistsError';
  }
}

/** HTTP status and code for the typed key errors; null for other errors. */
export function sshKeyErrorResponse(error: unknown): { status: number; code: string; message: string } | null {
  if (error instanceof SshCaKeyMigrationRequiredError || error instanceof SshCaKeyStoreError) {
    return { status: error.statusCode, code: error.code, message: error.message };
  }
  return null;
}

function keyStoreFailure(error: unknown, operation: string, caId?: string): Error {
  if (error instanceof SshCaKeyMigrationRequiredError || error instanceof SshCaKeyStoreError) return error;
  if (error instanceof OpenBaoConfigError) {
    logger.error({ operation, caId, reason: error.message }, 'OpenBao SSH key store is not configured');
    return new SshCaKeyStoreError(503, 'SSH_KEYSTORE_UNAVAILABLE', 'SSH CA key store is not configured');
  }
  if (error instanceof OpenBaoError) {
    logger.warn({ operation, caId, status: error.status, path: error.path, detail: error.detail }, 'OpenBao SSH request failed');
    // Transport errors, sealed (503) or proxy failures: unavailable. OpenBao also
    // answers 500 for refused requests (for example a version it does not have).
    if (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504) return new SshCaKeyStoreError(503, 'SSH_KEYSTORE_UNAVAILABLE', 'SSH CA key store is unavailable');
    return new SshCaKeyStoreError(502, 'SSH_KEY_OPERATION_FAILED', 'SSH CA key operation failed');
  }
  if (error instanceof OpenBaoResponseError) logger.warn({ operation, caId, reason: error.message }, 'OpenBao SSH response rejected');
  else logger.warn({ operation, caId, err: String(error) }, 'OpenBao SSH operation failed');
  return new SshCaKeyStoreError(502, 'SSH_KEY_OPERATION_FAILED', 'SSH CA key operation failed');
}

/** Public key of a recorded `ecdsa-sha2-nistp256` CA line. */
export function caPublicKeyFromLine(line: string): KeyObject {
  const parsed = parseSshPublicKey(line);
  if (parsed.algo !== 'ecdsa-sha2-nistp256' || !parsed.ecdsa || parsed.ecdsa.q.length !== 65 || parsed.ecdsa.q[0] !== 0x04) {
    throw new OpenBaoResponseError('recorded SSH CA key is not ECDSA P-256');
  }
  const q = parsed.ecdsa.q;
  return createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: q.subarray(1, 33).toString('base64url'), y: q.subarray(33, 65).toString('base64url') },
    format: 'jwk',
  });
}

function opensshLine(publicKey: KeyObject, comment: string): string {
  return spkiToOpenSshEcdsa(publicKey.export({ format: 'der', type: 'spki' }), comment);
}

/** Parses the stored key id of a CA; a non-OpenBao id is a legacy Cosmian key. */
export function sshCaKeyRef(ca: { id?: string; kmsKeyId: string; kmsPublicKeyId?: string }): SshCaKeyRef {
  if (!isOpenBaoSshKeyRef(ca.kmsKeyId)) throw new SshCaKeyMigrationRequiredError(ca.id);
  if (ca.kmsPublicKeyId !== undefined && ca.kmsPublicKeyId !== ca.kmsKeyId) {
    throw keyStoreFailure(new OpenBaoResponseError('SSH CA key and public key references differ'), 'ref', ca.id);
  }
  try { return parseSshKeyRef(ca.kmsKeyId); } catch (error) { throw keyStoreFailure(error, 'ref', ca.id); }
}

/** True when the CA still has a legacy Cosmian key id. */
export function isLegacySshCa(ca: { kmsKeyId: string }): boolean {
  return !isOpenBaoSshKeyRef(ca.kmsKeyId);
}

/**
 * Creates the Transit key of a new CA (`ssh-ca-<caId>`, version 1) and returns
 * the reference to store and the OpenSSH public key line.
 */
export async function createSshCaKey(caId: string, comment: string): Promise<{ keyRef: string; opensshPublicKey: string }> {
  try {
    const { ref, publicKey } = await getOpenBaoSshTransit().createKey(`ssh-ca-${caId}`);
    return { keyRef: formatSshKeyRef(ref), opensshPublicKey: opensshLine(publicKey, comment) };
  } catch (error) { throw keyStoreFailure(error, 'create', caId); }
}

/**
 * Checks an existing Transit key for `import`: the reference must be in the SSH
 * mount and the key must meet the policy (an imported key is allowed: that is
 * how a migrated Cosmian CA key arrives). Returns the OpenSSH public key line.
 */
export async function adoptSshCaKey(keyRef: string, comment: string): Promise<{ keyRef: string; opensshPublicKey: string }> {
  const ref = sshCaKeyRef({ kmsKeyId: keyRef });
  try {
    const publicKey = await getOpenBaoSshTransit().readKey(ref, { allowImported: true });
    if (!publicKey) throw new OpenBaoResponseError('SSH CA key does not exist');
    return { keyRef: formatSshKeyRef(ref), opensshPublicKey: opensshLine(publicKey, comment) };
  } catch (error) { throw keyStoreFailure(error, 'adopt'); }
}

// Key policy checks are cached per reference for a short time, so a KRL burst
// does not read the key for every signature. Every signature is still verified.
const POLICY_TTL_MS = 5 * 60_000;
const checked = new Map<string, number>();
/** Tests only. */
export function resetSshCaKeyCache(): void { checked.clear(); }

type SignableCa = { id: string; kmsKeyId: string; kmsPublicKeyId?: string; opensshPublicKey: string };

/**
 * Signs `data` with the CA key and returns the DER ECDSA signature. The key is
 * pinned to the CA's recorded public key; the signature is verified locally.
 * Writes an `ssh.ca.sign` audit row (success and failure).
 */
export async function signWithSshCa(
  ca: SignableCa,
  data: Buffer,
  opts: { purpose: 'certificate' | 'krl' | 'host-krl' | 'probe'; ctx?: Pick<ServiceContext, 'db' | 'ipAddress'> },
): Promise<Buffer> {
  const auditDb = opts.ctx?.db ?? defaultDb;
  const audit = (status: 'success' | 'failure', details: Record<string, unknown>) => createAuditLog({
    db: auditDb, operation: 'ssh.ca.sign', entityType: 'ssh_ca', entityId: ca.id, status,
    details: { purpose: opts.purpose, bytes: data.length, ...details }, ipAddress: opts.ctx?.ipAddress ?? undefined,
  });
  try {
    const ref = sshCaKeyRef(ca);
    const transit = getOpenBaoSshTransit();
    let pinned: KeyObject;
    try { pinned = caPublicKeyFromLine(ca.opensshPublicKey); } catch (error) { throw keyStoreFailure(error, 'sign', ca.id); }
    const cacheKey = `${ca.kmsKeyId}|${ca.opensshPublicKey}`;
    try {
      if ((checked.get(cacheKey) ?? 0) < Date.now()) {
        const current = await transit.readKey(ref, { allowImported: true });
        if (!current) throw new OpenBaoResponseError('SSH CA key does not exist');
        if (!OpenBaoSshTransit.samePublicKey(current, pinned)) throw new OpenBaoResponseError('SSH CA key does not match the recorded CA public key');
        checked.set(cacheKey, Date.now() + POLICY_TTL_MS);
      }
      const der = await transit.sign(ref, data, pinned);
      await audit('success', { keyRef: ca.kmsKeyId });
      return der;
    } catch (error) {
      checked.delete(cacheKey);
      throw keyStoreFailure(error, 'sign', ca.id);
    }
  } catch (error) {
    await audit('failure', { keyRef: ca.kmsKeyId, error: error instanceof Error ? error.message : 'SSH CA key operation failed' });
    throw error;
  }
}
