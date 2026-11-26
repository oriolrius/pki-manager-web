/**
 * Local X.509 certificate building with a remote signer (decision-018, doc-012 §3).
 *
 * PKI Manager builds the TBSCertificate itself and a key store (OpenBao Transit) signs it.
 * Names and SubjectPublicKeyInfo are copied as raw DER, so RSA and ECDSA keys are handled the
 * same way (node-forge models RSA keys only).
 *
 * The rules follow what the Cosmian KMS `Certify` operation did for PKI Manager:
 * - version 3, notBefore = now, notAfter = now + days (default 365), clamped to the days
 *   left on the issuer certificate;
 * - a positive, random, 20-octet serial number;
 * - for a CSR: its subject, its public key and its requested extensions, then the extensions of
 *   the caller (a caller extension replaces a CSR extension with the same OID);
 * - the issuer name is the issuer certificate's subject, byte for byte;
 * - signature: sha256WithRSAEncryption for RSA issuers, ecdsa-with-SHA256 for P-256 and
 *   ecdsa-with-SHA384 for P-384 issuers.
 *
 * Every built certificate is verified with the issuer public key before it is returned.
 */
import { X509Certificate, createPublicKey, randomBytes, verify as nodeVerify, type KeyObject } from 'node:crypto';
import {
  DerError, TAG, bitString, bitStringBytes, child, decodeOid, decodeTime, explicit, nullValue, oid, parseDer, seq, set,
  smallInteger, time, tlv, unsignedInteger, type DerNode,
} from './der.js';
import { OID, encodeExtension, keyIdentifier, type EncodedExtension } from './x509-extensions.js';

export class CertificateBuildError extends Error {}

export type SigningHash = 'sha256' | 'sha384';

/** Signs the DER TBS bytes; returns the X.509 signature value (RSA PKCS#1 v1.5 or ECDSA DER). */
export type TbsSigner = (tbs: Buffer, hash: SigningHash) => Promise<Buffer>;

export interface SignatureAlgorithm {
  hash: SigningHash;
  /** DER AlgorithmIdentifier. */
  algorithmIdentifier: Buffer;
  keyType: 'rsa' | 'ec';
}

/** Signature algorithm of an issuer key (same choice as the Cosmian KMS). */
export function signatureAlgorithmFor(issuerPublicKey: KeyObject): SignatureAlgorithm {
  if (issuerPublicKey.asymmetricKeyType === 'rsa') {
    return { hash: 'sha256', keyType: 'rsa', algorithmIdentifier: seq(oid('1.2.840.113549.1.1.11'), nullValue()) };
  }
  if (issuerPublicKey.asymmetricKeyType === 'ec') {
    const curve = issuerPublicKey.asymmetricKeyDetails?.namedCurve;
    if (curve === 'prime256v1') return { hash: 'sha256', keyType: 'ec', algorithmIdentifier: seq(oid('1.2.840.10045.4.3.2')) };
    if (curve === 'secp384r1') return { hash: 'sha384', keyType: 'ec', algorithmIdentifier: seq(oid('1.2.840.10045.4.3.3')) };
    throw new CertificateBuildError(`unsupported issuer curve ${curve ?? 'unknown'}`);
  }
  throw new CertificateBuildError(`unsupported issuer key type ${issuerPublicKey.asymmetricKeyType ?? 'unknown'}`);
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export interface NameFields {
  CN?: string;
  OU?: string;
  O?: string;
  L?: string;
  ST?: string;
  C?: string;
}

const NAME_OIDS: Record<keyof NameFields, string> = {
  CN: '2.5.4.3',
  OU: '2.5.4.11',
  C: '2.5.4.6',
  ST: '2.5.4.8',
  L: '2.5.4.7',
  O: '2.5.4.10',
};

/** Attribute order of the names the Cosmian KMS built for PKI Manager. */
const NAME_ORDER: Array<keyof NameFields> = ['CN', 'OU', 'C', 'ST', 'L', 'O'];

/** DER Name: one attribute per RDN; countryName as PrintableString, the others as UTF8String. */
export function encodeName(fields: NameFields): Buffer {
  const rdns: Buffer[] = [];
  for (const key of NAME_ORDER) {
    const value = fields[key];
    if (value === undefined || value === '') continue;
    if (value.length > 256) throw new CertificateBuildError(`${key} is too long`);
    let encoded: Buffer;
    if (key === 'C') {
      if (!/^[A-Za-z]{2}$/.test(value)) throw new CertificateBuildError('C must be a 2-letter country code');
      encoded = tlv(TAG.PRINTABLE_STRING, Buffer.from(value, 'ascii'));
    } else {
      encoded = tlv(TAG.UTF8_STRING, Buffer.from(value, 'utf8'));
    }
    rdns.push(set(seq(oid(NAME_OIDS[key]), encoded)));
  }
  if (rdns.length === 0) throw new CertificateBuildError('the subject name is empty');
  return seq(...rdns);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedSpki {
  /** Whole SubjectPublicKeyInfo DER. */
  raw: Buffer;
  /** Contents of the subjectPublicKey BIT STRING. */
  subjectPublicKey: Buffer;
  key: KeyObject;
}

function readSpki(node: DerNode): ParsedSpki {
  if (node.tag !== TAG.SEQUENCE) throw new DerError('SubjectPublicKeyInfo is not a SEQUENCE');
  const subjectPublicKey = bitStringBytes(child(node, 1, TAG.BIT_STRING));
  const key = createPublicKey({ key: Buffer.from(node.raw), format: 'der', type: 'spki' });
  return { raw: Buffer.from(node.raw), subjectPublicKey, key };
}

/** Raw extensions of a certificate or CSR, in order. */
function readExtensions(seqNode: DerNode): EncodedExtension[] {
  if (seqNode.tag !== TAG.SEQUENCE) throw new DerError('Extensions is not a SEQUENCE');
  return seqNode.children.map((ext) => {
    const extOid = decodeOid(child(ext, 0, TAG.OID).value);
    let critical = false;
    let valueNode = child(ext, 1);
    if (valueNode.tag === TAG.BOOLEAN) {
      if (valueNode.value.length !== 1 || (valueNode.value[0] !== 0xff && valueNode.value[0] !== 0x00)) throw new DerError('invalid BOOLEAN');
      critical = valueNode.value[0] === 0xff;
      valueNode = child(ext, 2);
    }
    if (valueNode.tag !== TAG.OCTET_STRING) throw new DerError('extnValue is not an OCTET STRING');
    return { oid: extOid, critical, value: Buffer.from(valueNode.value) };
  });
}

export interface ParsedCertificate {
  der: Buffer;
  serialHex: string;
  issuerName: Buffer;
  subjectName: Buffer;
  notBefore: Date;
  notAfter: Date;
  spki: ParsedSpki;
  extensions: EncodedExtension[];
  /** Key identifier to put in the AKI of certificates this one issues. */
  keyId: Buffer;
  isCa: boolean;
}

export function parseCertificateDer(der: Buffer): ParsedCertificate {
  const cert = parseDer(der);
  const tbs = child(cert, 0, TAG.SEQUENCE);
  let i = 0;
  if (tbs.children[0]?.tag === 0xa0) i = 1; // explicit version
  const serial = child(tbs, i, TAG.INTEGER);
  const issuerName = Buffer.from(child(tbs, i + 2, TAG.SEQUENCE).raw);
  const validity = child(tbs, i + 3, TAG.SEQUENCE);
  const subjectName = Buffer.from(child(tbs, i + 4, TAG.SEQUENCE).raw);
  const spki = readSpki(child(tbs, i + 5, TAG.SEQUENCE));
  const extWrapper = tbs.children.slice(i + 6).find((n) => n.tag === 0xa3);
  const extensions = extWrapper ? readExtensions(child(extWrapper, 0, TAG.SEQUENCE)) : [];
  const ski = extensions.find((e) => e.oid === OID.subjectKeyIdentifier);
  let keyId = keyIdentifier(spki.subjectPublicKey);
  if (ski) {
    const inner = parseDer(ski.value);
    if (inner.tag === TAG.OCTET_STRING && inner.value.length > 0) keyId = Buffer.from(inner.value);
  }
  const bc = extensions.find((e) => e.oid === OID.basicConstraints);
  let isCa = false;
  if (bc) {
    const bcNode = parseDer(bc.value);
    isCa = bcNode.children[0]?.tag === TAG.BOOLEAN && bcNode.children[0].value[0] === 0xff;
  }
  let serialBytes = serial.value;
  while (serialBytes.length > 1 && serialBytes[0] === 0) serialBytes = serialBytes.subarray(1);
  return {
    der,
    serialHex: serialBytes.toString('hex'),
    issuerName,
    subjectName,
    notBefore: decodeTime(child(validity, 0)),
    notAfter: decodeTime(child(validity, 1)),
    spki,
    extensions,
    keyId,
    isCa,
  };
}

const EXTENSION_REQUEST_OIDS = new Set(['1.2.840.113549.1.9.14', '1.3.6.1.4.1.311.2.1.14']);

const CSR_SIG_HASH: Record<string, { hash: string; keyType: 'rsa' | 'ec' }> = {
  '1.2.840.113549.1.1.5': { hash: 'sha1', keyType: 'rsa' },
  '1.2.840.113549.1.1.14': { hash: 'sha224', keyType: 'rsa' },
  '1.2.840.113549.1.1.11': { hash: 'sha256', keyType: 'rsa' },
  '1.2.840.113549.1.1.12': { hash: 'sha384', keyType: 'rsa' },
  '1.2.840.113549.1.1.13': { hash: 'sha512', keyType: 'rsa' },
  '1.2.840.10045.4.1': { hash: 'sha1', keyType: 'ec' },
  '1.2.840.10045.4.3.1': { hash: 'sha224', keyType: 'ec' },
  '1.2.840.10045.4.3.2': { hash: 'sha256', keyType: 'ec' },
  '1.2.840.10045.4.3.3': { hash: 'sha384', keyType: 'ec' },
  '1.2.840.10045.4.3.4': { hash: 'sha512', keyType: 'ec' },
};

export interface ParsedCsr {
  subjectName: Buffer;
  spki: ParsedSpki;
  extensions: EncodedExtension[];
}

/** Public keys a CSR may carry: RSA 2048..8192 bits, ECDSA P-256 or P-384. */
export function assertSupportedSubjectKey(key: KeyObject): void {
  if (key.asymmetricKeyType === 'rsa') {
    const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits < 2048 || bits > 8192) throw new CertificateBuildError('RSA keys must have 2048 to 8192 bits');
    return;
  }
  if (key.asymmetricKeyType === 'ec') {
    const curve = key.asymmetricKeyDetails?.namedCurve;
    if (curve === 'prime256v1' || curve === 'secp384r1') return;
    throw new CertificateBuildError('EC keys must use P-256 or P-384');
  }
  throw new CertificateBuildError('the public key must be RSA or ECDSA');
}

/**
 * Parse a PKCS#10 CSR, check its signature (proof of possession) and its key, and return its
 * subject, key and requested extensions. Duplicate requested extensions are refused.
 */
export function parseCsr(der: Buffer): ParsedCsr {
  const csr = parseDer(der);
  const info = child(csr, 0, TAG.SEQUENCE);
  const sigAlgOid = decodeOid(child(child(csr, 1, TAG.SEQUENCE), 0, TAG.OID).value);
  const signature = bitStringBytes(child(csr, 2, TAG.BIT_STRING));
  const version = child(info, 0, TAG.INTEGER);
  if (version.value.length !== 1 || version.value[0] !== 0) throw new CertificateBuildError('unsupported CSR version');
  const subjectName = Buffer.from(child(info, 1, TAG.SEQUENCE).raw);
  const spki = readSpki(child(info, 2, TAG.SEQUENCE));
  assertSupportedSubjectKey(spki.key);

  const sig = CSR_SIG_HASH[sigAlgOid];
  if (!sig) throw new CertificateBuildError(`unsupported CSR signature algorithm ${sigAlgOid}`);
  if (sig.keyType !== spki.key.asymmetricKeyType) throw new CertificateBuildError('CSR signature algorithm does not match its key');
  if (!nodeVerify(sig.hash, info.raw, spki.key, signature)) throw new CertificateBuildError('CSR signature is invalid');

  const extensions: EncodedExtension[] = [];
  const attrs = info.children.slice(3).find((n) => n.tag === 0xa0);
  for (const attr of attrs?.children ?? []) {
    const attrOid = decodeOid(child(attr, 0, TAG.OID).value);
    if (!EXTENSION_REQUEST_OIDS.has(attrOid)) continue;
    const values = child(attr, 1, TAG.SET);
    for (const value of values.children) extensions.push(...readExtensions(value));
  }
  const seen = new Set<string>();
  for (const ext of extensions) {
    if (seen.has(ext.oid)) throw new CertificateBuildError(`CSR requests extension ${ext.oid} more than once`);
    seen.add(ext.oid);
    if (ext.oid === OID.basicConstraints) {
      const bc = parseDer(ext.value);
      if (bc.children[0]?.tag === TAG.BOOLEAN && bc.children[0].value[0] === 0xff) {
        throw new CertificateBuildError('CSR requests CA:TRUE');
      }
    }
  }
  return { subjectName, spki, extensions };
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** Positive, non-zero, 20-octet serial number (RFC 5280 §4.1.2.2 allows up to 20). */
export function randomSerial(): Buffer {
  const bytes = randomBytes(20);
  bytes[0] = bytes[0] & 0x7f || 0x01;
  return bytes;
}

/** CSR extensions first, then the caller's; a caller extension replaces the CSR one with the same OID. */
export function mergeExtensions(base: EncodedExtension[], overrides: EncodedExtension[]): EncodedExtension[] {
  const out = [...base];
  for (const ext of overrides) {
    const at = out.findIndex((e) => e.oid === ext.oid);
    if (at >= 0) out[at] = ext;
    else out.push(ext);
  }
  return out;
}

/** notBefore now (whole seconds); notAfter after `days`, at most the days left on the issuer. */
export function validityWindow(days: number | undefined, issuerNotAfter: Date | undefined, now = new Date()): { notBefore: Date; notAfter: Date } {
  const notBefore = new Date(Math.floor(now.getTime() / 1000) * 1000);
  let wanted = days && days > 0 ? Math.floor(days) : 365;
  if (issuerNotAfter) {
    const left = Math.floor((issuerNotAfter.getTime() - notBefore.getTime()) / 86_400_000);
    if (left < 1) throw new CertificateBuildError('the issuing CA certificate expires in less than one day');
    wanted = Math.min(wanted, left);
  }
  return { notBefore, notAfter: new Date(notBefore.getTime() + wanted * 86_400_000) };
}

export interface BuildCertificateInput {
  subjectName: Buffer;
  spki: Buffer;
  issuerName: Buffer;
  issuerPublicKey: KeyObject;
  serial: Buffer;
  notBefore: Date;
  notAfter: Date;
  extensions: EncodedExtension[];
  signer: TbsSigner;
}

function assertEcdsaDerSignature(sig: Buffer): void {
  const node = parseDer(sig);
  if (node.tag !== TAG.SEQUENCE || node.children.length !== 2 || node.children.some((c) => c.tag !== TAG.INTEGER)) {
    throw new CertificateBuildError('the signer did not return an ECDSA DER signature');
  }
}

/** Build, sign and verify a certificate. Returns its DER. */
export async function buildCertificate(input: BuildCertificateInput): Promise<Buffer> {
  const alg = signatureAlgorithmFor(input.issuerPublicKey);
  const seen = new Set<string>();
  for (const ext of input.extensions) {
    if (seen.has(ext.oid)) throw new CertificateBuildError(`extension ${ext.oid} appears more than once`);
    seen.add(ext.oid);
  }
  const tbs = seq(
    explicit(0, smallInteger(2)),
    unsignedInteger(input.serial),
    alg.algorithmIdentifier,
    input.issuerName,
    seq(time(input.notBefore), time(input.notAfter)),
    input.subjectName,
    input.spki,
    ...(input.extensions.length > 0 ? [explicit(3, seq(...input.extensions.map(encodeExtension)))] : []),
  );
  const signature = await input.signer(tbs, alg.hash);
  if (alg.keyType === 'ec') assertEcdsaDerSignature(signature);
  const der = seq(tbs, alg.algorithmIdentifier, bitString(signature));
  let ok = false;
  try {
    ok = new X509Certificate(der).verify(input.issuerPublicKey);
  } catch {
    ok = false;
  }
  if (!ok) throw new CertificateBuildError('the signed certificate does not verify with the issuer public key');
  return der;
}
