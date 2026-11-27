/**
 * The Transit key policy that the v4 runtime clients require, per purpose. The
 * migration tool cannot import the backend modules, so this file repeats their
 * checks; test/key-policy.test.ts runs both on the same key responses and
 * compares the verdicts.
 *
 *   x509     backend/src/openbao/x509-transit.ts  parseTransitKey + assertKeyMatchesType
 *   ssh-ca   backend/src/openbao/ssh-transit.ts   checkSshCaKeyPolicy (allowImported: true)
 *   scep-ra  backend/src/openbao/ra-transit.ts    checkRAKeyPolicy (allowImported when the
 *            binding has an RA certificate) + assertKeyName
 *
 * On top of the runtime parsers, `runtimeKeyProblems` checks what the runtime
 * operations need from OpenBao for the pinned version (OpenBao fork
 * sdk/helper/keysutil): `sign` refuses a soft-deleted key and a version below
 * `min_encryption_version`; the session-key operation refuses a version below
 * `min_decryption_version`; a version below `min_available_version` is gone.
 * The fork always returns `derived`, `deletion_allowed`, `soft_deleted`,
 * `supports_signing` and the three `min_*_version` fields, and
 * `imported_key_allow_rotation` for an imported key: an absent field is refused.
 */
import { createPublicKey, type KeyObject } from 'node:crypto';
import type { KeyClass } from './types.ts';

export type Purpose = 'x509' | 'ssh-ca' | 'scep-ra';
export const purposeOf = (cls: KeyClass): Purpose => (cls === 'ssh-ca' ? 'ssh-ca' : cls === 'scep-ra' ? 'scep-ra' : 'x509');

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

const X509_TYPES = ['rsa-2048', 'rsa-3072', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384'];
/** Key names the runtime clients accept (x509-transit, ssh-transit, ra-transit). */
const NAMES: Record<Purpose, RegExp> = {
  'x509': /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/,
  'ssh-ca': /^ssh-ca-[A-Za-z0-9_-]{1,100}$/,
  'scep-ra': /^scep-ra-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

export interface RuntimeCheck {
  /** Empty when the runtime client accepts the key and can use `version`. */
  problems: string[];
  /** Public key PEM of `version`, when it parses. */
  publicKeyPem: string | null;
}

function matchesType(key: KeyObject, type: string): boolean {
  const d = key.asymmetricKeyDetails;
  return type.startsWith('rsa-')
    ? key.asymmetricKeyType === 'rsa' && d?.modulusLength === Number(type.slice(4))
    : key.asymmetricKeyType === 'ec' && d?.namedCurve === (type === 'ecdsa-p256' ? 'prime256v1' : type === 'ecdsa-p384' ? 'secp384r1' : '');
}

/**
 * Checks a raw `GET <mount>/keys/<name>` data object against the runtime client
 * of `purpose` for key `version`. `allowImported` is the runtime option: true for
 * SSH CAs (ssh-ca-key.ts) and for an RA binding that has a certificate (ra.service.ts).
 */
export function runtimeKeyProblems(purpose: Purpose, name: string, data: unknown, version: number, opts: { allowImported: boolean }): RuntimeCheck {
  const bad: string[] = [];
  if (!NAMES[purpose].test(name)) bad.push(`name ${name} is not a name the v4 ${purpose} client accepts`);
  if (!Number.isInteger(version) || version < 1) return { problems: [...bad, `invalid key version ${version}`], publicKeyPem: null };
  if (!isObject(data)) return { problems: [...bad, 'key response has no data'], publicKeyPem: null };
  const d = data;
  const type = String(d.type ?? '');
  const expectedType = purpose === 'ssh-ca' ? 'ecdsa-p256' : purpose === 'scep-ra' ? 'rsa-3072' : null;
  if (expectedType ? type !== expectedType : !X509_TYPES.includes(type)) bad.push(`type ${type || '(none)'} is not ${expectedType ?? X509_TYPES.join('/')}`);
  const imported = d.imported_key === true;
  if (typeof d.imported_key !== 'boolean') bad.push('imported_key missing');
  if (imported && !opts.allowImported) bad.push('an imported key is not accepted here (the runtime requires a generated key)');
  if (imported && d.imported_key_allow_rotation !== false) bad.push(`imported key: imported_key_allow_rotation is ${String(d.imported_key_allow_rotation)}, not false`);
  if (d.soft_deleted !== false) bad.push(`soft_deleted is ${String(d.soft_deleted)}, not false`);
  if (d.derived !== false) bad.push(`derived is ${String(d.derived)}, not false`);
  if (d.deletion_allowed !== false) bad.push(`deletion_allowed is ${String(d.deletion_allowed)}, not false`);
  if (d.supports_signing !== true) bad.push('supports_signing is not true');
  if (typeof d.exportable !== 'boolean') bad.push('exportable flag missing');
  else if (purpose !== 'x509' && d.exportable) bad.push('exportable is true (the runtime requires a non-exportable key)');
  if (d.allow_plaintext_backup !== false) bad.push(`allow_plaintext_backup is ${String(d.allow_plaintext_backup)}, not false`);
  if (purpose === 'scep-ra') {
    if (d.allow_pkcs1v15_session_key !== true) bad.push('not opted in to PKCS#1 v1.5 session-key transport');
  } else if (d.allow_pkcs1v15_session_key === true) bad.push('unexpected PKCS#1 v1.5 session-key opt-in');
  if (d.auto_rotate_period !== undefined && d.auto_rotate_period !== 0) bad.push(`auto_rotate_period is ${String(d.auto_rotate_period)}, not 0`);

  const ints = ['latest_version', 'min_available_version', 'min_encryption_version', 'min_decryption_version'] as const;
  const v: Record<string, number> = {};
  for (const f of ints) {
    if (!Number.isInteger(d[f])) bad.push(`${f} missing`);
    else v[f] = d[f] as number;
  }
  if (v.latest_version !== undefined && v.latest_version < version) bad.push(`latest_version ${v.latest_version} < pinned version ${version}`);
  if (v.min_available_version !== undefined && v.min_available_version > version) bad.push(`min_available_version ${v.min_available_version} > pinned version ${version}`);
  // Transit sign: refused below min_encryption_version (0 means "no minimum").
  if (v.min_encryption_version !== undefined && v.min_encryption_version > version) bad.push(`min_encryption_version ${v.min_encryption_version} > pinned version ${version} (sign refused)`);
  if (purpose === 'scep-ra' && v.min_decryption_version !== undefined && v.min_decryption_version > version) bad.push(`min_decryption_version ${v.min_decryption_version} > pinned version ${version} (session key refused)`);

  const entry = isObject(d.keys) ? d.keys[String(version)] : undefined;
  const pem = isObject(entry) && typeof entry.public_key === 'string' ? entry.public_key : null;
  if (!pem) { bad.push(`no public key for version ${version}`); return { problems: bad, publicKeyPem: null }; }
  let key: KeyObject;
  try { key = createPublicKey(pem); } catch { bad.push(`public key of version ${version} does not parse`); return { problems: bad, publicKeyPem: null }; }
  if (type && !matchesType(key, type)) bad.push(`public key does not match key type ${type}`);
  return { problems: bad, publicKeyPem: pem };
}
