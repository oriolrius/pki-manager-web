/**
 * Certificate Revocation List (CRL) generation utilities
 *
 * Produces RFC 5280 X.509 v2 CRLs. The TBSCertList is built with node-forge's ASN.1
 * primitives (forge has no native CRL support) and signed with Node's `crypto` module,
 * which signs reliably for both RSA (PKCS#1 v1.5) and ECDSA (DER signature) keys — unlike
 * node-forge, whose EC signing is unreliable.
 */

import * as nodeCrypto from 'node:crypto';
import forge from 'node-forge';
import { logger } from '../lib/logger.js';
import { dnToForgeAttributes, formatDN, validateDN } from './dn.js';
import { CRLReason } from './types.js';
import type { CRLParams, GeneratedCRL, CertificateFormat, SignatureAlgorithm } from './types.js';

const { asn1 } = forge;
const { Class, Type } = asn1;

/** RFC 5280 extension OIDs */
const OID_CRL_NUMBER = '2.5.29.20';
const OID_CRL_REASON = '2.5.29.21';
const OID_AUTHORITY_KEY_IDENTIFIER = '2.5.29.35';

/** Signature AlgorithmIdentifier metadata, keyed by our SignatureAlgorithm union. */
interface SigAlgInfo {
  oid: string;
  /** RSA algorithms carry an explicit NULL parameter; ECDSA omits parameters entirely. */
  rsaNullParams: boolean;
  /** Node digest name used both for signing and verification. */
  hash: 'sha256' | 'sha384' | 'sha512';
  keyType: 'rsa' | 'ec';
}

const SIG_ALGS: Record<SignatureAlgorithm, SigAlgInfo> = {
  'SHA256-RSA': { oid: '1.2.840.113549.1.1.11', rsaNullParams: true, hash: 'sha256', keyType: 'rsa' },
  'SHA384-RSA': { oid: '1.2.840.113549.1.1.12', rsaNullParams: true, hash: 'sha384', keyType: 'rsa' },
  'SHA512-RSA': { oid: '1.2.840.113549.1.1.13', rsaNullParams: true, hash: 'sha512', keyType: 'rsa' },
  'SHA256-ECDSA': { oid: '1.2.840.10045.4.3.2', rsaNullParams: false, hash: 'sha256', keyType: 'ec' },
  'SHA384-ECDSA': { oid: '1.2.840.10045.4.3.3', rsaNullParams: false, hash: 'sha384', keyType: 'ec' },
};

/** Lookup table from signature OID back to its metadata (for parsing/verification). */
const SIG_ALG_BY_OID: Record<string, SigAlgInfo> = Object.fromEntries(
  Object.values(SIG_ALGS).map((info) => [info.oid, info]),
) as Record<string, SigAlgInfo>;

/** Build the AlgorithmIdentifier SEQUENCE for a signature algorithm. */
function algorithmIdentifier(info: SigAlgInfo): forge.asn1.Asn1 {
  const children: forge.asn1.Asn1[] = [
    asn1.create(Class.UNIVERSAL, Type.OID, false, asn1.oidToDer(info.oid).getBytes()),
  ];
  // RSA carries an explicit NULL; ECDSA omits the parameters field (RFC 5758).
  if (info.rsaNullParams) {
    children.push(asn1.create(Class.UNIVERSAL, Type.NULL, false, ''));
  }
  return asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, children);
}

/**
 * Encode a certificate serial number (hex string) as the value bytes of a DER INTEGER,
 * guaranteeing a positive two's-complement representation (leading 0x00 when the high bit
 * is set) and canonical minimal length.
 */
function serialIntegerValue(serialHex: string): string {
  let hex = serialHex.replace(/[:\s]/g, '').toLowerCase();
  if (hex.length === 0) hex = '00';
  if (hex.length % 2 !== 0) hex = '0' + hex;
  let bytes = forge.util.hexToBytes(hex);
  // Strip superfluous leading zero bytes (keep at least one).
  while (bytes.length > 1 && bytes.charCodeAt(0) === 0 && (bytes.charCodeAt(1) & 0x80) === 0) {
    bytes = bytes.slice(1);
  }
  // Prepend 0x00 if the high bit is set, so the INTEGER stays positive.
  if ((bytes.charCodeAt(0) & 0x80) !== 0) {
    bytes = String.fromCharCode(0) + bytes;
  }
  return bytes;
}

/** A DER Time: UTCTime for 1950–2049, GeneralizedTime otherwise (RFC 5280 §4.1.2.5). */
function timeAsn1(date: Date): forge.asn1.Asn1 {
  const year = date.getUTCFullYear();
  if (year >= 1950 && year < 2050) {
    return asn1.create(Class.UNIVERSAL, Type.UTCTIME, false, asn1.dateToUtcTime(date));
  }
  return asn1.create(Class.UNIVERSAL, Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(date));
}

/** Wrap a DER-encoded value in an X.509 Extension (extnID, optional critical, extnValue). */
function extension(oid: string, valueDer: string, critical = false): forge.asn1.Asn1 {
  const children: forge.asn1.Asn1[] = [
    asn1.create(Class.UNIVERSAL, Type.OID, false, asn1.oidToDer(oid).getBytes()),
  ];
  if (critical) {
    children.push(asn1.create(Class.UNIVERSAL, Type.BOOLEAN, false, String.fromCharCode(0xff)));
  }
  children.push(asn1.create(Class.UNIVERSAL, Type.OCTETSTRING, false, valueDer));
  return asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, children);
}

/** crlEntryExtensions for a single revoked cert: a non-critical CRL reason code, if meaningful. */
function reasonExtension(reason?: CRLReason): forge.asn1.Asn1 | null {
  if (reason === undefined || reason === CRLReason.UNSPECIFIED) return null;
  const valueDer = asn1.toDer(
    asn1.create(Class.UNIVERSAL, Type.ENUMERATED, false, asn1.integerToDer(reason).getBytes()),
  ).getBytes();
  return extension(OID_CRL_REASON, valueDer);
}

/** cRLNumber extension (monotonic counter, non-critical). */
function crlNumberExtension(crlNumber: number): forge.asn1.Asn1 {
  const intDer = asn1.toDer(
    asn1.create(Class.UNIVERSAL, Type.INTEGER, false, asn1.integerToDer(crlNumber).getBytes()),
  ).getBytes();
  return extension(OID_CRL_NUMBER, intDer);
}

/**
 * authorityKeyIdentifier extension built from the issuing CA certificate's SubjectKeyIdentifier,
 * so the AKI on the CRL matches the SKI on the CA cert. Returns null if the CA cert exposes no SKI.
 */
function authorityKeyIdentifierExtension(issuerCertificatePem?: string): forge.asn1.Asn1 | null {
  if (!issuerCertificatePem) return null;
  try {
    const cert = forge.pki.certificateFromPem(issuerCertificatePem);
    const ski = cert.extensions.find((e: any) => e.name === 'subjectKeyIdentifier') as any;
    const skiHex: string | undefined = ski?.subjectKeyIdentifier;
    if (!skiHex) return null;
    // AuthorityKeyIdentifier ::= SEQUENCE { keyIdentifier [0] OCTET STRING OPTIONAL }
    const keyId = asn1.create(Class.CONTEXT_SPECIFIC, 0, false, forge.util.hexToBytes(skiHex));
    const akiValue = asn1.toDer(asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [keyId])).getBytes();
    return extension(OID_AUTHORITY_KEY_IDENTIFIER, akiValue);
  } catch (error) {
    logger.warn({ error }, 'Could not derive AKI from issuer certificate; omitting from CRL');
    return null;
  }
}

/**
 * Generate a signed X.509 v2 Certificate Revocation List.
 *
 * The CA private key (PEM, PKCS#8) is supplied in `params.signingKey`. Pass
 * `params.issuerCertificate` (PEM) to embed an authorityKeyIdentifier matching the CA's SKI.
 */
export function generateCRL(params: CRLParams): GeneratedCRL {
  try {
    const validation = validateDN(params.issuer);
    if (!validation.valid) {
      throw new Error(`Invalid issuer DN: ${validation.errors.join(', ')}`);
    }

    // Build the issuer Name. When the CA certificate is supplied, copy its subject DN
    // verbatim so the CRL issuer byte-matches the CA's subject (required for openssl/clients
    // to associate the CRL with its issuer). Otherwise re-encode from the DN fields.
    let issuerNameAsn1: forge.asn1.Asn1;
    if (params.issuerCertificate) {
      const caCert = forge.pki.certificateFromPem(params.issuerCertificate);
      issuerNameAsn1 = forge.pki.distinguishedNameToAsn1(caCert.subject);
    } else {
      issuerNameAsn1 = forge.pki.distinguishedNameToAsn1({ attributes: dnToForgeAttributes(params.issuer) });
    }
    const thisUpdate = params.thisUpdate || new Date();
    const nextUpdate = params.nextUpdate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const crlNumber = params.crlNumber ?? 1;

    // Resolve the signature algorithm and validate it against the actual key type.
    const sigAlgName: SignatureAlgorithm = params.signatureAlgorithm || 'SHA256-RSA';
    const sigInfo = SIG_ALGS[sigAlgName];
    if (!sigInfo) {
      throw new Error(`Unsupported signature algorithm: ${sigAlgName}`);
    }
    const keyObject = nodeCrypto.createPrivateKey(params.signingKey);
    if (keyObject.asymmetricKeyType !== sigInfo.keyType) {
      throw new Error(
        `Signature algorithm ${sigAlgName} expects a ${sigInfo.keyType} key but the signing key is ${keyObject.asymmetricKeyType}`,
      );
    }

    // --- revokedCertificates SEQUENCE OF ---
    const revokedCertificates: forge.asn1.Asn1[] = [];
    for (const entry of params.revokedCertificates) {
      const entryChildren: forge.asn1.Asn1[] = [
        asn1.create(Class.UNIVERSAL, Type.INTEGER, false, serialIntegerValue(entry.serialNumber)),
        timeAsn1(entry.revocationDate),
      ];
      const reasonExt = reasonExtension(entry.reason);
      if (reasonExt) {
        // crlEntryExtensions ::= Extensions (a bare SEQUENCE OF Extension)
        entryChildren.push(asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [reasonExt]));
      }
      revokedCertificates.push(asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, entryChildren));
    }

    // --- crlExtensions [0] EXPLICIT (cRLNumber, optional AKI) ---
    const crlExtensions: forge.asn1.Asn1[] = [crlNumberExtension(crlNumber)];
    const akiExt = authorityKeyIdentifierExtension(params.issuerCertificate);
    if (akiExt) crlExtensions.push(akiExt);

    // --- TBSCertList ---
    const tbsChildren: forge.asn1.Asn1[] = [
      // version v2 (INTEGER 1) — present because we emit crlExtensions
      asn1.create(Class.UNIVERSAL, Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
      algorithmIdentifier(sigInfo),
      issuerNameAsn1,
      timeAsn1(thisUpdate),
      timeAsn1(nextUpdate),
    ];
    if (revokedCertificates.length > 0) {
      tbsChildren.push(asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, revokedCertificates));
    }
    // crlExtensions [0] EXPLICIT Extensions
    tbsChildren.push(
      asn1.create(Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, crlExtensions),
      ]),
    );

    const tbsCertList = asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, tbsChildren);
    const tbsDer = Buffer.from(asn1.toDer(tbsCertList).getBytes(), 'binary');

    // --- Sign the TBSCertList with Node crypto (RSA PKCS#1 v1.5 or ECDSA DER) ---
    const signature = nodeCrypto.sign(sigInfo.hash, tbsDer, keyObject);
    const signatureBits = String.fromCharCode(0x00) + signature.toString('binary');

    // --- CertificateList ::= SEQUENCE { tbsCertList, signatureAlgorithm, signatureValue } ---
    const crlAsn1 = asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
      tbsCertList,
      algorithmIdentifier(sigInfo),
      asn1.create(Class.UNIVERSAL, Type.BITSTRING, false, signatureBits),
    ]);

    const derBytes = asn1.toDer(crlAsn1).getBytes();
    const der = forge.util.encode64(derBytes);
    const pem = `-----BEGIN X509 CRL-----\n${der.match(/.{1,64}/g)?.join('\n')}\n-----END X509 CRL-----`;

    logger.info(
      {
        issuer: formatDN(params.issuer),
        crlNumber,
        revokedCount: params.revokedCertificates.length,
        signatureAlgorithm: sigAlgName,
        thisUpdate,
        nextUpdate,
      },
      'CRL generated',
    );

    return {
      pem,
      der,
      crlNumber,
      revokedCount: params.revokedCertificates.length,
    };
  } catch (error) {
    logger.error({ error }, 'Failed to generate CRL');
    throw new Error(`CRL generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Decode a CRL (PEM or DER-as-base64) to a forge ASN.1 object. */
function crlToAsn1(data: string, format: CertificateFormat): forge.asn1.Asn1 {
  const base64 =
    format === 'PEM'
      ? data.replace(/-----BEGIN X509 CRL-----/g, '').replace(/-----END X509 CRL-----/g, '').replace(/\s/g, '')
      : data.replace(/\s/g, '');
  return asn1.fromDer(forge.util.decode64(base64));
}

interface ParsedCRL {
  issuer: forge.pki.CertificateField[];
  thisUpdate: Date;
  nextUpdate: Date;
  crlNumber: number | null;
  signatureAlgorithmOid: string;
  revokedCertificates: Array<{ serialNumber: string; revocationDate: Date; reason: CRLReason | null }>;
}

/**
 * Parse a CRL (PEM or DER) into its meaningful fields. Throws on a structurally invalid CRL.
 */
export function parseCRL(data: string, format: CertificateFormat = 'PEM'): ParsedCRL {
  try {
    const root = crlToAsn1(data, format);
    if (root.type !== Type.SEQUENCE || !Array.isArray(root.value)) {
      throw new Error('Invalid CRL: root is not a SEQUENCE');
    }
    const tbs = root.value[0];
    if (!tbs || !Array.isArray(tbs.value)) {
      throw new Error('Invalid CRL: missing TBSCertList');
    }
    const tbsFields = tbs.value as forge.asn1.Asn1[];

    // The version field is optional. With v2 it's an INTEGER at index 0; detect by type.
    let idx = 0;
    let hasVersion = false;
    if (tbsFields[0]?.type === Type.INTEGER) {
      hasVersion = true;
      idx = 1;
    }
    // [signature AlgorithmIdentifier], [issuer], [thisUpdate], [nextUpdate?]
    const sigAlg = tbsFields[idx];
    const sigOid = asn1.derToOid((sigAlg.value as forge.asn1.Asn1[])[0].value as string);
    const issuerAsn1 = tbsFields[idx + 1];
    const issuer = (forge.pki as any).RDNAttributesAsArray(issuerAsn1) as forge.pki.CertificateField[];
    const thisUpdate = asn1ToDate(tbsFields[idx + 2]);

    let cursor = idx + 3;
    let nextUpdate = thisUpdate;
    if (tbsFields[cursor] && (tbsFields[cursor].type === Type.UTCTIME || tbsFields[cursor].type === Type.GENERALIZEDTIME)) {
      nextUpdate = asn1ToDate(tbsFields[cursor]);
      cursor++;
    }

    // Optional revokedCertificates SEQUENCE OF (a UNIVERSAL SEQUENCE that is not the [0] ext block).
    const revoked: ParsedCRL['revokedCertificates'] = [];
    if (
      tbsFields[cursor] &&
      tbsFields[cursor].type === Type.SEQUENCE &&
      tbsFields[cursor].tagClass === Class.UNIVERSAL
    ) {
      for (const entry of tbsFields[cursor].value as forge.asn1.Asn1[]) {
        const fields = entry.value as forge.asn1.Asn1[];
        const serialNumber = normalizeSerialHex(forge.util.bytesToHex(fields[0].value as string));
        const revocationDate = asn1ToDate(fields[1]);
        let reason: CRLReason | null = null;
        if (fields[2] && Array.isArray(fields[2].value)) {
          for (const ext of fields[2].value as forge.asn1.Asn1[]) {
            const extOid = asn1.derToOid((ext.value as forge.asn1.Asn1[])[0].value as string);
            if (extOid === OID_CRL_REASON) {
              const octet = (ext.value as forge.asn1.Asn1[]).find((e) => e.type === Type.OCTETSTRING);
              if (octet) {
                const inner = asn1.fromDer(octet.value as string);
                reason = (inner.value as string).charCodeAt(0) as CRLReason;
              }
            }
          }
        }
        revoked.push({ serialNumber, revocationDate, reason });
      }
      cursor++;
    }

    // crlExtensions [0] EXPLICIT — pull out cRLNumber if present.
    let crlNumber: number | null = null;
    const extBlock = tbsFields.find((f) => f.tagClass === Class.CONTEXT_SPECIFIC && f.type === 0);
    if (extBlock && Array.isArray(extBlock.value) && Array.isArray(extBlock.value[0]?.value)) {
      for (const ext of extBlock.value[0].value as forge.asn1.Asn1[]) {
        const extOid = asn1.derToOid((ext.value as forge.asn1.Asn1[])[0].value as string);
        if (extOid === OID_CRL_NUMBER) {
          const octet = (ext.value as forge.asn1.Asn1[]).find((e) => e.type === Type.OCTETSTRING);
          if (octet) {
            const inner = asn1.fromDer(octet.value as string);
            crlNumber = parseInt(forge.util.bytesToHex(inner.value as string) || '0', 16);
          }
        }
      }
    }
    void hasVersion;

    return {
      issuer,
      thisUpdate,
      nextUpdate,
      crlNumber,
      signatureAlgorithmOid: sigOid,
      revokedCertificates: revoked,
    };
  } catch (error) {
    throw new Error(`Failed to parse CRL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Normalize a serial-number hex string: lowercase, strip separators, and drop any leading
 * 0x00 sign-padding byte (added by DER INTEGER encoding when the high bit is set) — but never
 * a significant leading-zero nibble. Keeps full-byte hex so "0a1b2c" stays "0a1b2c".
 */
function normalizeSerialHex(hex: string): string {
  let h = hex.toLowerCase().replace(/[:\s]/g, '');
  if (h.length % 2 !== 0) h = '0' + h;
  while (h.length > 2 && h.startsWith('00')) h = h.slice(2);
  return h;
}

function asn1ToDate(node: forge.asn1.Asn1): Date {
  if (node.type === Type.GENERALIZEDTIME) {
    return asn1.generalizedTimeToDate(node.value as string);
  }
  return asn1.utcTimeToDate(node.value as string);
}

/**
 * Verify a CRL's signature against the issuing CA's public key (PEM, of the CA cert or key).
 */
export function verifyCRL(crlData: string, issuerPublicKeyPem: string, format: CertificateFormat = 'PEM'): boolean {
  try {
    const root = crlToAsn1(crlData, format);
    const fields = root.value as forge.asn1.Asn1[];
    const tbsDer = Buffer.from(asn1.toDer(fields[0]).getBytes(), 'binary');
    const sigOid = asn1.derToOid((fields[1].value as forge.asn1.Asn1[])[0].value as string);
    const info = SIG_ALG_BY_OID[sigOid];
    if (!info) {
      logger.warn({ sigOid }, 'CRL verification: unknown signature algorithm OID');
      return false;
    }
    // BIT STRING value begins with the unused-bits octet (0x00); strip it. forge may
    // recursively decompose the bit-string contents when they happen to be valid DER (an
    // ECDSA signature is a DER SEQUENCE), so read the raw bytes from `bitStringContents`.
    const sigBits = ((fields[2] as any).bitStringContents ?? fields[2].value) as string;
    const signature = Buffer.from(sigBits.slice(1), 'binary');

    // Accept either a CA certificate PEM (extract its public key) or a bare public key PEM.
    const publicKey = issuerPublicKeyPem.includes('CERTIFICATE')
      ? new nodeCrypto.X509Certificate(issuerPublicKeyPem).publicKey
      : nodeCrypto.createPublicKey(issuerPublicKeyPem);
    return nodeCrypto.verify(info.hash, tbsDer, publicKey, signature);
  } catch (error) {
    logger.error({ error }, 'CRL verification failed');
    return false;
  }
}

/**
 * Check if a certificate (by serial number) is revoked according to a CRL.
 */
export function isCertificateRevoked(crlData: string, serialNumber: string, format: CertificateFormat = 'PEM'): boolean {
  try {
    const parsed = parseCRL(crlData, format);
    const normalized = normalizeSerialHex(serialNumber);
    return parsed.revokedCertificates.some((rc) => normalizeSerialHex(rc.serialNumber) === normalized);
  } catch (error) {
    logger.error({ error }, 'Failed to check certificate revocation');
    return false;
  }
}

/**
 * Convert CRL between PEM and DER (base64) representations.
 */
export function convertCRLFormat(data: string, fromFormat: CertificateFormat, toFormat: CertificateFormat): string {
  if (fromFormat === toFormat) return data;
  try {
    const base64 =
      fromFormat === 'PEM'
        ? data.replace(/-----BEGIN X509 CRL-----/g, '').replace(/-----END X509 CRL-----/g, '').replace(/\s/g, '')
        : data;
    if (toFormat === 'PEM') {
      return `-----BEGIN X509 CRL-----\n${base64.match(/.{1,64}/g)?.join('\n')}\n-----END X509 CRL-----`;
    }
    return base64;
  } catch (error) {
    throw new Error(`Failed to convert CRL format: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Check if a CRL is expired (past nextUpdate). */
export function isCRLExpired(crlData: string, format: CertificateFormat = 'PEM'): boolean {
  try {
    return new Date() > parseCRL(crlData, format).nextUpdate;
  } catch (error) {
    logger.error({ error }, 'Failed to check CRL expiration');
    return true;
  }
}

/** Get a CRL's nextUpdate date. */
export function getCRLNextUpdate(crlData: string, format: CertificateFormat = 'PEM'): Date {
  return parseCRL(crlData, format).nextUpdate;
}

/** Count revoked certificates in a CRL. */
export function countRevokedCertificates(crlData: string, format: CertificateFormat = 'PEM'): number {
  try {
    return parseCRL(crlData, format).revokedCertificates.length;
  } catch (error) {
    logger.error({ error }, 'Failed to count revoked certificates');
    return 0;
  }
}
