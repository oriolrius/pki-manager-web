/**
 * Provider-neutral key store contract (decision-018, doc-011 §2).
 *
 * Once certificates and CRLs are built in the backend, PKI Manager needs only these operations
 * from a key store. The private key of a CA or a leaf never leaves the store, except through
 * `exportPrivateKeyPkcs8` for a key that was created exportable (leaf downloads, and CA
 * keystore downloads when `ALLOW_CA_KEY_EXPORT` was on when the CA was created).
 */
import type { KeyObject } from 'node:crypto';

export type KeyAlg = 'RSA-2048' | 'RSA-3072' | 'RSA-4096' | 'ECDSA-P256' | 'ECDSA-P384';
export const KEY_ALGS: readonly KeyAlg[] = ['RSA-2048', 'RSA-3072', 'RSA-4096', 'ECDSA-P256', 'ECDSA-P384'];
export type SignHash = 'sha256' | 'sha384' | 'sha512';

/** Where one key version lives. Stored in `keystore_objects`; never chosen by an API caller. */
export interface KeyRef {
  provider: 'openbao';
  mount: string;
  name: string;
  version: number;
  alg: KeyAlg;
}

export type KeyStoreState = 'ready' | 'sealed' | 'uninitialized' | 'unauthorized' | 'unavailable';

export interface KeyStore {
  /** Generate a key inside the store. `exportable` can never become true later. */
  createKey(o: { name: string; alg: KeyAlg; exportable: boolean }): Promise<{ ref: KeyRef; publicKey: KeyObject }>;
  /**
   * Sign `data` (the store hashes it) and return the X.509 signature value:
   * RSASSA-PKCS1-v1_5 (with DigestInfo) for RSA, DER `ECDSA-Sig-Value` for ECDSA.
   */
  sign(ref: KeyRef, data: Buffer, hash: SignHash): Promise<Buffer>;
  /** PKCS#8 PEM of the private key. The store refuses keys that are not exportable. */
  exportPrivateKeyPkcs8(ref: KeyRef): Promise<string>;
  /** Delete the key for good. Idempotent. */
  destroy(ref: KeyRef): Promise<void>;
  /** Operator diagnostics: reachable and unsealed, sealed, not initialized, bad token, down. */
  status(): Promise<KeyStoreState>;
}

export function isKeyAlg(value: string): value is KeyAlg {
  return (KEY_ALGS as readonly string[]).includes(value);
}

/** Normalise the key algorithm strings the services use ("RSA-4096", "ECDSA-P256", "EC-P256"). */
export function toKeyAlg(value: string | undefined, fallbackRsaBits = 4096): KeyAlg {
  if (!value) {
    const alg = `RSA-${fallbackRsaBits}`;
    if (isKeyAlg(alg)) return alg;
    throw new Error(`Unsupported RSA key size ${fallbackRsaBits}`);
  }
  const v = value.trim().toUpperCase().replace(/^EC-/, 'ECDSA-');
  if (isKeyAlg(v)) return v;
  throw new Error(`Unsupported key algorithm ${value}`);
}
