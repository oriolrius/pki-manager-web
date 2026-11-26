/**
 * X.509 v3 extensions for locally built certificates.
 *
 * The services describe extensions in the OpenSSL configuration syntax that the Cosmian KMS
 * read (`[ v3_ca ]` + `key=value` lines, see `buildCertificateExtensions`). This module reads
 * exactly the subset that PKI Manager writes and encodes each extension in DER. Anything else
 * (an unknown key, an unknown value, a duplicate key) is an error: the parser fails closed.
 *
 * Supported keys: basicConstraints, keyUsage, extendedKeyUsage, subjectAltName,
 * subjectKeyIdentifier=hash, authorityKeyIdentifier=keyid[:always], crlDistributionPoints.
 */
import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { booleanTrue, octetString, oid, seq, smallInteger, tlv, TAG } from './der.js';

export class ExtensionConfigError extends Error {}

export const OID = {
  subjectKeyIdentifier: '2.5.29.14',
  keyUsage: '2.5.29.15',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  crlDistributionPoints: '2.5.29.31',
  authorityKeyIdentifier: '2.5.29.35',
  extendedKeyUsage: '2.5.29.37',
} as const;

/** One encoded extension, ready to go into the Extensions SEQUENCE. */
export interface EncodedExtension {
  oid: string;
  critical: boolean;
  /** DER of the extnValue contents (inside the OCTET STRING). */
  value: Buffer;
}

export function encodeExtension(ext: EncodedExtension): Buffer {
  return seq(oid(ext.oid), ...(ext.critical ? [booleanTrue()] : []), octetString(ext.value));
}

/** Key identifiers computed while building: SKI of the subject, SKI of the issuer. */
export interface ExtensionContext {
  /** Contents of the subject SPKI BIT STRING (the subjectPublicKey). */
  subjectPublicKey: Buffer;
  /** Key identifier of the issuer: its SKI extension, else SHA-1 of its public key. */
  issuerKeyId: Buffer;
}

/** RFC 5280 §4.2.1.2 method 1: SHA-1 of the subjectPublicKey BIT STRING value. */
export function keyIdentifier(subjectPublicKey: Buffer): Buffer {
  return createHash('sha1').update(subjectPublicKey).digest();
}

const KEY_USAGE_BITS: Record<string, number> = {
  digitalsignature: 0,
  nonrepudiation: 1,
  contentcommitment: 1,
  keyencipherment: 2,
  dataencipherment: 3,
  keyagreement: 4,
  keycertsign: 5,
  crlsign: 6,
  encipheronly: 7,
  decipheronly: 8,
};

const EKU_OIDS: Record<string, string> = {
  serverauth: '1.3.6.1.5.5.7.3.1',
  clientauth: '1.3.6.1.5.5.7.3.2',
  codesigning: '1.3.6.1.5.5.7.3.3',
  emailprotection: '1.3.6.1.5.5.7.3.4',
  timestamping: '1.3.6.1.5.5.7.3.8',
  ocspsigning: '1.3.6.1.5.5.7.3.9',
};

function splitList(value: string): { critical: boolean; items: string[] } {
  const items = value.split(',').map((s) => s.trim());
  if (items.some((s) => s.length === 0)) throw new ExtensionConfigError('empty list item');
  const critical = items[0] === 'critical';
  return { critical, items: critical ? items.slice(1) : items };
}

/** DER BIT STRING for KeyUsage: minimal length, unused bits counted in the last byte. */
function keyUsageBits(bits: number[]): Buffer {
  const highest = Math.max(...bits);
  const bytes = Buffer.alloc(Math.floor(highest / 8) + 1);
  for (const bit of bits) bytes[Math.floor(bit / 8)] |= 0x80 >> (bit % 8);
  const last = bytes[bytes.length - 1];
  let unused = 0;
  while (unused < 7 && (last & (1 << unused)) === 0) unused++;
  return tlv(TAG.BIT_STRING, Buffer.from([unused]), bytes);
}

/** IPv4 / IPv6 text to its 4- or 16-byte network form. */
export function ipToBytes(text: string): Buffer {
  if (isIPv4(text)) return Buffer.from(text.split('.').map(Number));
  if (!isIPv6(text)) throw new ExtensionConfigError(`invalid IP address ${text}`);
  let head = text;
  let v4Tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  if (text.includes('.')) {
    v4Tail = text.slice(lastColon + 1).split('.').map(Number);
    head = text.slice(0, lastColon + 1) + '0:0';
  }
  const [left, right] = head.includes('::') ? head.split('::') : [head, undefined];
  const leftGroups = left ? left.split(':') : [];
  const rightGroups = right ? right.split(':') : [];
  const missing = 8 - leftGroups.length - rightGroups.length;
  const groups = right === undefined ? leftGroups : [...leftGroups, ...Array(missing).fill('0'), ...rightGroups];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) throw new ExtensionConfigError(`invalid IP address ${text}`);
  const out = Buffer.alloc(16);
  groups.forEach((g, i) => out.writeUInt16BE(parseInt(g, 16), i * 2));
  if (v4Tail.length === 4) v4Tail.forEach((b, i) => (out[12 + i] = b));
  return out;
}

function ia5(value: string, what: string): Buffer {
  if (value.length === 0 || /[^\x20-\x7e]/.test(value)) throw new ExtensionConfigError(`${what} must be printable ASCII`);
  return Buffer.from(value, 'ascii');
}

function generalName(entry: string): Buffer {
  const idx = entry.indexOf(':');
  if (idx <= 0) throw new ExtensionConfigError(`invalid subjectAltName entry ${entry}`);
  const kind = entry.slice(0, idx).trim().toLowerCase();
  const value = entry.slice(idx + 1).trim();
  switch (kind) {
    case 'dns':
      return tlv(0x82, ia5(value, 'DNS name'));
    case 'ip':
      return tlv(0x87, ipToBytes(value));
    case 'email':
      return tlv(0x81, ia5(value, 'email address'));
    case 'uri':
      return tlv(0x86, ia5(value, 'URI'));
    default:
      throw new ExtensionConfigError(`unsupported subjectAltName type ${kind}`);
  }
}

function parseBool(value: string): boolean {
  const v = value.trim().toUpperCase();
  if (['TRUE', 'YES', 'Y'].includes(v)) return true;
  if (['FALSE', 'NO', 'N'].includes(v)) return false;
  throw new ExtensionConfigError(`invalid boolean ${value}`);
}

function buildOne(key: string, value: string, ctx: ExtensionContext): EncodedExtension {
  switch (key) {
    case 'basicConstraints': {
      const { critical, items } = splitList(value);
      let ca: boolean | undefined;
      let pathLen: number | undefined;
      for (const item of items) {
        const [k, v] = item.split(':').map((s) => s.trim());
        if (k.toUpperCase() === 'CA' && v !== undefined && ca === undefined) ca = parseBool(v);
        else if (k.toLowerCase() === 'pathlen' && v !== undefined && /^\d{1,3}$/.test(v) && pathLen === undefined) pathLen = Number(v);
        else throw new ExtensionConfigError(`invalid basicConstraints item ${item}`);
      }
      if (ca === undefined) throw new ExtensionConfigError('basicConstraints needs CA:TRUE or CA:FALSE');
      if (pathLen !== undefined && !ca) throw new ExtensionConfigError('pathlen requires CA:TRUE');
      const body = [...(ca ? [booleanTrue()] : []), ...(pathLen !== undefined ? [smallInteger(pathLen)] : [])];
      return { oid: OID.basicConstraints, critical, value: seq(...body) };
    }
    case 'keyUsage': {
      const { critical, items } = splitList(value);
      const bits = items.map((item) => {
        const bit = KEY_USAGE_BITS[item.toLowerCase()];
        if (bit === undefined) throw new ExtensionConfigError(`unknown keyUsage ${item}`);
        return bit;
      });
      if (bits.length === 0) throw new ExtensionConfigError('keyUsage is empty');
      return { oid: OID.keyUsage, critical, value: keyUsageBits(bits) };
    }
    case 'extendedKeyUsage': {
      const { critical, items } = splitList(value);
      const oids = items.map((item) => {
        const known = EKU_OIDS[item.toLowerCase()];
        if (known) return known;
        if (/^\d+(\.\d+)+$/.test(item)) return item;
        throw new ExtensionConfigError(`unknown extendedKeyUsage ${item}`);
      });
      if (oids.length === 0) throw new ExtensionConfigError('extendedKeyUsage is empty');
      return { oid: OID.extendedKeyUsage, critical, value: seq(...oids.map((o) => oid(o))) };
    }
    case 'subjectAltName': {
      const { critical, items } = splitList(value);
      if (items.length === 0) throw new ExtensionConfigError('subjectAltName is empty');
      return { oid: OID.subjectAltName, critical, value: seq(...items.map(generalName)) };
    }
    case 'subjectKeyIdentifier': {
      if (value.trim() !== 'hash') throw new ExtensionConfigError('subjectKeyIdentifier supports only hash');
      return { oid: OID.subjectKeyIdentifier, critical: false, value: octetString(keyIdentifier(ctx.subjectPublicKey)) };
    }
    case 'authorityKeyIdentifier': {
      const v = value.trim();
      if (v !== 'keyid' && v !== 'keyid:always') throw new ExtensionConfigError('authorityKeyIdentifier supports only keyid[:always]');
      return { oid: OID.authorityKeyIdentifier, critical: false, value: seq(tlv(0x80, ctx.issuerKeyId)) };
    }
    case 'crlDistributionPoints': {
      const { critical, items } = splitList(value);
      const points = items.map((item) => {
        if (!/^URI:/i.test(item)) throw new ExtensionConfigError('crlDistributionPoints supports only URI: entries');
        const uri = tlv(0x86, ia5(item.slice(4).trim(), 'CRL URI'));
        // DistributionPoint { distributionPoint [0] { fullName [0] GeneralNames } }
        return seq(tlv(0xa0, tlv(0xa0, uri)));
      });
      return { oid: OID.crlDistributionPoints, critical, value: seq(...points) };
    }
    default:
      throw new ExtensionConfigError(`unsupported extension ${key}`);
  }
}

/**
 * Parse the extension text and encode every extension, in text order.
 * An empty text, or a text with only the section header, gives no extension.
 */
export function buildExtensionsFromConfig(text: string | undefined, ctx: ExtensionContext): EncodedExtension[] {
  if (!text) return [];
  const out: EncodedExtension[] = [];
  const seen = new Set<string>();
  let sectionSeen = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (/^\[\s*v3_ca\s*\]$/.test(line)) {
      if (sectionSeen) throw new ExtensionConfigError('duplicate section');
      sectionSeen = true;
      continue;
    }
    if (line.startsWith('[')) throw new ExtensionConfigError(`unsupported section ${line}`);
    const eq = line.indexOf('=');
    if (eq <= 0) throw new ExtensionConfigError(`invalid extension line`);
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (seen.has(key)) throw new ExtensionConfigError(`duplicate extension ${key}`);
    seen.add(key);
    out.push(buildOne(key, value, ctx));
  }
  return out;
}
