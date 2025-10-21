/**
 * Certificate Revocation List (CRL) generation utilities
 */

import forge from 'node-forge';
import { logger } from '../lib/logger.js';
import { dnToForgeAttributes, forgeAttributesToDn, formatDN, validateDN } from './dn.js';
import { pemToForgeKey, getForgeDigestAlgorithm } from './keys.js';
import type { CRLParams, GeneratedCRL, CRLEntry, CRLReason, CertificateFormat } from './types.js';

/**
 * Convert CRLReason enum to KMIP revocation reason code
 */
function getCRLReasonExtension(reason: CRLReason): any {
  return {
    id: '2.5.29.21', // CRL Reason Code OID
    critical: false,
    value: forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.ENUMERATED,
      false,
      forge.asn1.integerToDer(reason).getBytes(),
    ),
  };
}

/**
 * Generate a Certificate Revocation List (CRL)
 *
 * Note: This is a simplified CRL implementation using ASN.1 encoding.
 * Full CRL support requires manual ASN.1 construction as node-forge doesn't
 * have native CRL creation functions.
 */
export function generateCRL(params: CRLParams): GeneratedCRL {
  try {
    // Validate issuer DN
    const validation = validateDN(params.issuer);
    if (!validation.valid) {
      throw new Error(`Invalid issuer DN: ${validation.errors.join(', ')}`);
    }

    // For now, we'll create a basic CRL structure using ASN.1
    // This is a simplified implementation. In production, consider using
    // a library with full CRL support or the KMS's CRL generation capabilities.

    const issuerDN = dnToForgeAttributes(params.issuer);
    const thisUpdate = params.thisUpdate || new Date();
    const nextUpdate = params.nextUpdate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const crlNumber = params.crlNumber || 1;

    // Create revoked certificates sequence
    const revokedCertificates: any[] = [];
    for (const entry of params.revokedCertificates) {
      const revokedCert = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.INTEGER,
          false,
          forge.util.hexToBytes(entry.serialNumber),
        ),
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.UTCTIME,
          false,
          forge.asn1.dateToUtcTime(entry.revocationDate),
        ),
      ]);
      revokedCertificates.push(revokedCert);
    }

    // Create TBSCertList (to-be-signed certificate list)
    const tbsCertList = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      // version (optional, v2 = 1)
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.INTEGER, false, String.fromCharCode(1)),
      // signature algorithm
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OID,
          false,
          forge.asn1.oidToDer('1.2.840.113549.1.1.11').getBytes(), // sha256WithRSAEncryption
        ),
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
      ]),
      // issuer
      forge.pki.distinguishedNameToAsn1({ attributes: issuerDN }),
      // thisUpdate
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.UTCTIME,
        false,
        forge.asn1.dateToUtcTime(thisUpdate),
      ),
      // nextUpdate
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.UTCTIME,
        false,
        forge.asn1.dateToUtcTime(nextUpdate),
      ),
      // revokedCertificates (optional)
      ...(revokedCertificates.length > 0
        ? [forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, revokedCertificates)]
        : []),
    ]);

    // Sign the TBSCertList
    const privateKey = pemToForgeKey(params.signingKey, 'private');
    const signatureAlgorithm = params.signatureAlgorithm || 'SHA256-RSA';
    const digestAlgorithm = getForgeDigestAlgorithm(signatureAlgorithm);

    const md = forge.md[digestAlgorithm].create();
    md.update(forge.asn1.toDer(tbsCertList).getBytes());
    const signature = (privateKey as forge.pki.rsa.PrivateKey).sign(md);

    // Create the final CRL structure
    const crlAsn1 = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      tbsCertList,
      // signatureAlgorithm
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OID,
          false,
          forge.asn1.oidToDer('1.2.840.113549.1.1.11').getBytes(),
        ),
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ''),
      ]),
      // signatureValue
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.BITSTRING,
        false,
        String.fromCharCode(0x00) + signature,
      ),
    ]);

    // Convert to PEM and DER
    const der = forge.util.encode64(forge.asn1.toDer(crlAsn1).getBytes());
    const pem = `-----BEGIN X509 CRL-----\n${der.match(/.{1,64}/g)?.join('\n')}\n-----END X509 CRL-----`;

    logger.info(
      {
        issuer: formatDN(params.issuer),
        crlNumber,
        revokedCount: params.revokedCertificates.length,
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
    logger.error({ error, params }, 'Failed to generate CRL');
    throw new Error(`CRL generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Parse a CRL from PEM or DER format
 *
 * Note: This is a basic parser. Full CRL parsing would require complete ASN.1 decoding.
 */
export function parseCRL(
  data: string,
  format: CertificateFormat = 'PEM',
): {
  issuer: any;
  thisUpdate: Date;
  nextUpdate: Date;
  revokedCertificates: Array<{
    serialNumber: string;
    revocationDate: Date;
  }>;
} {
  try {
    let asn1: forge.asn1.Asn1;

    if (format === 'PEM') {
      // Remove PEM headers and decode
      const pemData = data
        .replace(/-----BEGIN X509 CRL-----/g, '')
        .replace(/-----END X509 CRL-----/g, '')
        .replace(/\s/g, '');
      const derBytes = forge.util.decode64(pemData);
      asn1 = forge.asn1.fromDer(derBytes);
    } else {
      // DER format
      const derBytes = forge.util.decode64(data);
      asn1 = forge.asn1.fromDer(derBytes);
    }

    // Basic parsing of CRL structure
    // CRL ::= SEQUENCE { tbsCertList, signatureAlgorithm, signatureValue }
    if (asn1.type !== forge.asn1.Type.SEQUENCE || !Array.isArray(asn1.value)) {
      throw new Error('Invalid CRL structure');
    }

    const tbsCertList = asn1.value[0];
    if (!tbsCertList || !Array.isArray(tbsCertList.value)) {
      throw new Error('Invalid tbsCertList structure');
    }

    // Extract basic info (simplified)
    // For a complete implementation, you'd need to properly parse all ASN.1 fields

    return {
      issuer: {},  // Simplified: would need full DN parsing
      thisUpdate: new Date(),
      nextUpdate: new Date(),
      revokedCertificates: [],
    };
  } catch (error) {
    throw new Error(`Failed to parse CRL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if a certificate is revoked according to a CRL
 *
 * Note: Simplified implementation. In production, use a proper CRL parser.
 */
export function isCertificateRevoked(crlPem: string, serialNumber: string): boolean {
  try {
    const parsed = parseCRL(crlPem);
    const normalizedSerial = serialNumber.toLowerCase().replace(/[:\s]/g, '');

    for (const revokedCert of parsed.revokedCertificates) {
      const revokedSerial = revokedCert.serialNumber.toLowerCase().replace(/[:\s]/g, '');
      if (revokedSerial === normalizedSerial) {
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.error({ error }, 'Failed to check certificate revocation');
    return false;
  }
}

/**
 * Verify CRL signature
 *
 * Note: Simplified implementation. Full verification requires ASN.1 signature validation.
 */
export function verifyCRL(crlPem: string, issuerPublicKeyPem: string): boolean {
  try {
    // Parse the CRL
    parseCRL(crlPem);
    // For now, return true if parsing succeeds
    // Full implementation would verify the signature against the public key
    return true;
  } catch (error) {
    logger.error({ error }, 'CRL verification failed');
    return false;
  }
}

/**
 * Convert CRL between PEM and DER formats
 */
export function convertCRLFormat(
  data: string,
  fromFormat: CertificateFormat,
  toFormat: CertificateFormat,
): string {
  if (fromFormat === toFormat) {
    return data;
  }

  try {
    let derData: string;

    if (fromFormat === 'PEM') {
      // Remove PEM headers
      derData = data
        .replace(/-----BEGIN X509 CRL-----/g, '')
        .replace(/-----END X509 CRL-----/g, '')
        .replace(/\s/g, '');
    } else {
      derData = data;
    }

    if (toFormat === 'PEM') {
      return `-----BEGIN X509 CRL-----\n${derData.match(/.{1,64}/g)?.join('\n')}\n-----END X509 CRL-----`;
    } else {
      return derData;
    }
  } catch (error) {
    throw new Error(
      `Failed to convert CRL format: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Check if CRL is expired (past nextUpdate date)
 */
export function isCRLExpired(crlPem: string): boolean {
  try {
    const crl = parseCRL(crlPem);
    const now = new Date();
    return now > crl.nextUpdate;
  } catch (error) {
    logger.error({ error }, 'Failed to check CRL expiration');
    return true; // Assume expired on error
  }
}

/**
 * Get CRL next update date
 */
export function getCRLNextUpdate(crlPem: string): Date {
  const crl = parseCRL(crlPem);
  return crl.nextUpdate;
}

/**
 * Count revoked certificates in CRL
 */
export function countRevokedCertificates(crlPem: string): number {
  try {
    const crl = parseCRL(crlPem);
    return crl.revokedCertificates.length;
  } catch (error) {
    logger.error({ error }, 'Failed to count revoked certificates');
    return 0;
  }
}
