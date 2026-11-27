/**
 * Shared helpers of the offline v3 -> OpenBao migration tool.
 * Node built-ins only: the tool is not part of the backend image or runtime.
 */
import { createHash, createPublicKey, type KeyObject, X509Certificate } from 'node:crypto';

/** An error that stops the run. `code` is stable and goes in reports. */
export class MigrationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** JSON with sorted object keys, so the digest of a document is stable. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function documentDigest(doc: unknown): string {
  return sha256Hex(canonicalJson(doc));
}

export function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

/** DER SubjectPublicKeyInfo of a key, certificate or PEM public key. */
export function spkiDer(input: KeyObject | X509Certificate | string | Buffer): Buffer {
  let key: KeyObject;
  if (input instanceof X509Certificate) key = input.publicKey;
  else if (typeof input === 'string') key = createPublicKey(input);
  else if (Buffer.isBuffer(input)) key = createPublicKey({ key: input, format: 'der', type: 'spki' });
  else key = input;
  return key.export({ format: 'der', type: 'spki' }) as Buffer;
}

/** SHA-256 of the DER SPKI, lowercase hex: the provider-neutral key identity. */
export function spkiFingerprint(input: KeyObject | X509Certificate | string | Buffer): string {
  return sha256Hex(spkiDer(input));
}

export type TransitKeyType = 'rsa-2048' | 'rsa-3072' | 'rsa-4096' | 'ecdsa-p256' | 'ecdsa-p384';

/** The Transit key type of a public key, or null when Transit import does not support it here. */
export function transitTypeOf(key: KeyObject): TransitKeyType | null {
  if (key.asymmetricKeyType === 'rsa') {
    const bits = key.asymmetricKeyDetails?.modulusLength;
    if (bits === 2048 || bits === 3072 || bits === 4096) return `rsa-${bits}` as TransitKeyType;
    return null;
  }
  if (key.asymmetricKeyType === 'ec') {
    const curve = key.asymmetricKeyDetails?.namedCurve;
    if (curve === 'prime256v1') return 'ecdsa-p256';
    if (curve === 'secp384r1') return 'ecdsa-p384';
  }
  return null;
}

/** OpenSSH `SHA256:` fingerprint of an ECDSA P-256 SPKI (the SSH CA key form). */
export function sshFingerprintOfP256(spki: Buffer): string {
  const jwk = createPublicKey({ key: spki, format: 'der', type: 'spki' }).export({ format: 'jwk' }) as { crv?: string; x?: string; y?: string };
  if (jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new MigrationError('SSH_KEY_NOT_P256', 'SSH CA key is not ECDSA P-256');
  const q = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const str = (b: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(b.length); return Buffer.concat([len, b]); };
  const blob = Buffer.concat([str(Buffer.from('ecdsa-sha2-nistp256')), str(Buffer.from('nistp256')), str(q)]);
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

/** Normalize a hex serial (DB and certificate forms): lowercase, no separators, no leading zeros. */
export function normalizeSerial(serial: string): string {
  const hex = serial.replace(/[:\s]/g, '').toLowerCase().replace(/^0+/, '');
  return hex === '' ? '0' : hex;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A deterministic RFC 4122-shaped UUID from arbitrary text (stable target names on every run). */
export function uuidFromText(text: string): string {
  const h = createHash('sha256').update(`pki-manager-migration:${text}`).digest();
  h[6] = (h[6] & 0x0f) | 0x80; // version nibble 8 (custom, RFC 9562)
  h[8] = (h[8] & 0x3f) | 0x80; // variant 10
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** The source id when it is a lowercase UUID, else a stable UUID derived from it. */
export function uuidForSourceId(sourceId: string): string {
  return UUID.test(sourceId) ? sourceId : uuidFromText(sourceId);
}

export function isoNow(): string {
  return new Date().toISOString();
}

/** Log line on stderr; never pass key material. */
export function log(message: string): void {
  process.stderr.write(`[pki-migrate] ${message}\n`);
}
