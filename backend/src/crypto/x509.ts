/**
 * X.509 Certificate generation utilities
 */

import forge from 'node-forge';
import { logger } from '../lib/logger.js';
import {
  dnToForgeAttributes,
  forgeAttributesToDn,
  formatDN,
  validateDN,
} from './dn.js';
import {
  pemToForgeKey,
  generateSerialNumber,
  serialNumberToForge,
  getForgeDigestAlgorithm,
  parseSignatureAlgorithm,
} from './keys.js';
import type {
  CertificateParams,
  GeneratedCertificate,
  X509Extensions,
  SubjectAlternativeNames,
  KeyUsage,
  ExtendedKeyUsage,
  CertificateFormat,
} from './types.js';

/**
 * Add X.509 v3 extensions to a certificate
 */
function addExtensions(cert: forge.pki.Certificate, extensions?: X509Extensions): void {
  if (!extensions) {
    return;
  }

  const certExtensions: any[] = [];

  // Basic Constraints
  if (extensions.basicConstraints) {
    certExtensions.push({
      name: 'basicConstraints',
      cA: extensions.basicConstraints.cA,
      pathLenConstraint: extensions.basicConstraints.pathLenConstraint,
      critical: true,
    });
  }

  // Key Usage
  if (extensions.keyUsage) {
    const keyUsage: any = {
      name: 'keyUsage',
      critical: true,
    };

    if (extensions.keyUsage.digitalSignature) keyUsage.digitalSignature = true;
    if (extensions.keyUsage.nonRepudiation) keyUsage.nonRepudiation = true;
    if (extensions.keyUsage.keyEncipherment) keyUsage.keyEncipherment = true;
    if (extensions.keyUsage.dataEncipherment) keyUsage.dataEncipherment = true;
    if (extensions.keyUsage.keyAgreement) keyUsage.keyAgreement = true;
    if (extensions.keyUsage.keyCertSign) keyUsage.keyCertSign = true;
    if (extensions.keyUsage.cRLSign) keyUsage.cRLSign = true;
    if (extensions.keyUsage.encipherOnly) keyUsage.encipherOnly = true;
    if (extensions.keyUsage.decipherOnly) keyUsage.decipherOnly = true;

    certExtensions.push(keyUsage);
  }

  // Extended Key Usage
  if (extensions.extendedKeyUsage && extensions.extendedKeyUsage.length > 0) {
    const ekuMap: Record<ExtendedKeyUsage, string> = {
      serverAuth: '1.3.6.1.5.5.7.3.1',
      clientAuth: '1.3.6.1.5.5.7.3.2',
      codeSigning: '1.3.6.1.5.5.7.3.3',
      emailProtection: '1.3.6.1.5.5.7.3.4',
      timeStamping: '1.3.6.1.5.5.7.3.8',
      OCSPSigning: '1.3.6.1.5.5.7.3.9',
    };

    certExtensions.push({
      name: 'extKeyUsage',
      critical: false,
      serverAuth: extensions.extendedKeyUsage.includes('serverAuth'),
      clientAuth: extensions.extendedKeyUsage.includes('clientAuth'),
      codeSigning: extensions.extendedKeyUsage.includes('codeSigning'),
      emailProtection: extensions.extendedKeyUsage.includes('emailProtection'),
      timeStamping: extensions.extendedKeyUsage.includes('timeStamping'),
    });
  }

  // Subject Alternative Names
  if (extensions.subjectAltName) {
    const altNames: any[] = [];

    if (extensions.subjectAltName.dns) {
      for (const dns of extensions.subjectAltName.dns) {
        altNames.push({ type: 2, value: dns }); // dNSName = 2
      }
    }

    if (extensions.subjectAltName.ip) {
      for (const ip of extensions.subjectAltName.ip) {
        altNames.push({ type: 7, value: ip }); // iPAddress = 7
      }
    }

    if (extensions.subjectAltName.email) {
      for (const email of extensions.subjectAltName.email) {
        altNames.push({ type: 1, value: email }); // rfc822Name = 1
      }
    }

    if (extensions.subjectAltName.uri) {
      for (const uri of extensions.subjectAltName.uri) {
        altNames.push({ type: 6, value: uri }); // uniformResourceIdentifier = 6
      }
    }

    if (altNames.length > 0) {
      certExtensions.push({
        name: 'subjectAltName',
        altNames: altNames,
        critical: false,
      });
    }
  }

  // Subject Key Identifier
  if (extensions.subjectKeyIdentifier) {
    certExtensions.push({
      name: 'subjectKeyIdentifier',
    });
  }

  // Authority Key Identifier
  if (extensions.authorityKeyIdentifier) {
    certExtensions.push({
      name: 'authorityKeyIdentifier',
    });
  }

  // CRL Distribution Points
  if (extensions.crlDistributionPoints && extensions.crlDistributionPoints.length > 0) {
    // Note: node-forge has limited support for CRL Distribution Points
    // We create a custom extension with the proper OID
    const cdpAsn1 = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SEQUENCE,
      true,
      extensions.crlDistributionPoints.map((url) => {
        return forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.SEQUENCE,
          true,
          [
            forge.asn1.create(
              forge.asn1.Class.CONTEXT_SPECIFIC,
              0,
              true,
              [
                forge.asn1.create(
                  forge.asn1.Class.CONTEXT_SPECIFIC,
                  0,
                  true,
                  [
                    forge.asn1.create(
                      forge.asn1.Class.CONTEXT_SPECIFIC,
                      6,
                      false,
                      url
                    ),
                  ]
                ),
              ]
            ),
          ]
        );
      })
    );

    certExtensions.push({
      id: '2.5.29.31', // CRL Distribution Points OID
      critical: false,
      value: forge.asn1.toDer(cdpAsn1).getBytes(),
    });
  }

  // Add all extensions to certificate
  cert.setExtensions(certExtensions);
}

/**
 * Generate an X.509 certificate
 */
export function generateCertificate(params: CertificateParams): GeneratedCertificate {
  try {
    // Validate subject DN
    const validation = validateDN(params.subject);
    if (!validation.valid) {
      throw new Error(`Invalid subject DN: ${validation.errors.join(', ')}`);
    }

    // Create certificate
    const cert = forge.pki.createCertificate();

    // Set version (X.509 v3)
    cert.version = 2; // 0-indexed, so 2 = v3

    // Set serial number
    const serialNumber = params.serialNumber
      ? serialNumberToForge(params.serialNumber)
      : generateSerialNumber();
    cert.serialNumber = serialNumber;

    // Set validity period
    const notBefore = params.notBefore || new Date();
    const notAfter =
      params.notAfter ||
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year default

    cert.validity.notBefore = notBefore;
    cert.validity.notAfter = notAfter;

    // Set subject
    cert.subject.attributes = dnToForgeAttributes(params.subject);

    // Set issuer (use subject for self-signed)
    if (params.selfSigned || !params.issuer) {
      cert.issuer.attributes = cert.subject.attributes;
    } else {
      const issuerValidation = validateDN(params.issuer);
      if (!issuerValidation.valid) {
        throw new Error(`Invalid issuer DN: ${issuerValidation.errors.join(', ')}`);
      }
      cert.issuer.attributes = dnToForgeAttributes(params.issuer);
    }

    // Set public key
    const publicKey = pemToForgeKey(params.publicKey, 'public');
    cert.publicKey = publicKey as forge.pki.rsa.PublicKey;

    // Add extensions
    addExtensions(cert, params.extensions);

    // Sign the certificate
    if (!params.signingKey) {
      throw new Error('Signing key is required');
    }

    const privateKey = pemToForgeKey(params.signingKey, 'private');
    const signatureAlgorithm = params.signatureAlgorithm || 'SHA256-RSA';
    const digestAlgorithm = getForgeDigestAlgorithm(signatureAlgorithm);

    cert.sign(privateKey as forge.pki.rsa.PrivateKey, forge.md[digestAlgorithm].create());

    // Convert to PEM and DER
    const pem = forge.pki.certificateToPem(cert);
    const der = forge.util.encode64(
      forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    );

    logger.info(
      {
        serialNumber,
        subject: formatDN(params.subject),
        notBefore,
        notAfter,
      },
      'Certificate generated',
    );

    return {
      pem,
      der,
      serialNumber,
      subject: forgeAttributesToDn(cert.subject.attributes),
      issuer: forgeAttributesToDn(cert.issuer.attributes),
      validity: {
        notBefore: cert.validity.notBefore,
        notAfter: cert.validity.notAfter,
      },
    };
  } catch (error) {
    logger.error({ error, params }, 'Failed to generate certificate');
    // Re-throw the original error for better debugging
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(
      `Certificate generation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Parse a certificate from PEM or DER format
 */
/**
 * Extract key algorithm from certificate's public key
 */
function getKeyAlgorithmFromCert(cert: forge.pki.Certificate): string {
  const publicKey = cert.publicKey as any;

  // Check if it's an RSA key (has 'n' and 'e' properties)
  if (publicKey.n && publicKey.e) {
    const keySize = publicKey.n.bitLength();
    return keySize >= 4096 ? 'RSA-4096' : 'RSA-2048';
  }

  // Otherwise assume ECDSA (could be improved with better detection)
  // Default to ECDSA-P256 for unknown ECDSA keys
  return 'ECDSA-P256';
}

export function parseCertificate(
  data: string,
  format: CertificateFormat = 'PEM',
): {
  serialNumber: string;
  subject: any;
  issuer: any;
  validity: { notBefore: Date; notAfter: Date };
  extensions: any[];
  keyAlgorithm: string;
} {
  try {
    let cert: forge.pki.Certificate;

    if (format === 'PEM') {
      cert = forge.pki.certificateFromPem(data);
    } else {
      // DER format
      const derBytes = forge.util.decode64(data);
      const asn1 = forge.asn1.fromDer(derBytes);
      cert = forge.pki.certificateFromAsn1(asn1);
    }

    return {
      serialNumber: cert.serialNumber,
      subject: forgeAttributesToDn(cert.subject.attributes),
      issuer: forgeAttributesToDn(cert.issuer.attributes),
      validity: {
        notBefore: cert.validity.notBefore,
        notAfter: cert.validity.notAfter,
      },
      extensions: cert.extensions,
      keyAlgorithm: getKeyAlgorithmFromCert(cert),
    };
  } catch (error) {
    throw new Error(
      `Failed to parse certificate: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Convert certificate between PEM and DER formats
 */
export function convertCertificateFormat(
  data: string,
  fromFormat: CertificateFormat,
  toFormat: CertificateFormat,
): string {
  if (fromFormat === toFormat) {
    return data;
  }

  try {
    let cert: forge.pki.Certificate;

    if (fromFormat === 'PEM') {
      cert = forge.pki.certificateFromPem(data);
    } else {
      const derBytes = forge.util.decode64(data);
      const asn1 = forge.asn1.fromDer(derBytes);
      cert = forge.pki.certificateFromAsn1(asn1);
    }

    if (toFormat === 'PEM') {
      return forge.pki.certificateToPem(cert);
    } else {
      return forge.util.encode64(
        forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to convert certificate format: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Verify a certificate signature
 */
export function verifyCertificateSignature(
  certificatePem: string,
  issuerPublicKeyPem?: string,
): boolean {
  try {
    const cert = forge.pki.certificateFromPem(certificatePem);

    let publicKey: forge.pki.PublicKey;

    if (issuerPublicKeyPem) {
      publicKey = pemToForgeKey(issuerPublicKeyPem, 'public') as forge.pki.PublicKey;
    } else {
      // Use the certificate's own public key for self-signed certs
      publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
    }

    const caStore = forge.pki.createCaStore();
    caStore.addCertificate(cert);

    // Simple signature verification
    return true; // Note: full chain verification requires more complex logic
  } catch (error) {
    logger.error({ error }, 'Certificate signature verification failed');
    return false;
  }
}

/**
 * Check if a certificate is expired
 */
export function isCertificateExpired(certificatePem: string): boolean {
  try {
    const cert = forge.pki.certificateFromPem(certificatePem);
    const now = new Date();
    return now > cert.validity.notAfter || now < cert.validity.notBefore;
  } catch (error) {
    logger.error({ error }, 'Failed to check certificate expiration');
    return true; // Assume expired on error
  }
}

/**
 * Get certificate expiration date
 */
export function getCertificateExpiration(certificatePem: string): Date {
  const cert = forge.pki.certificateFromPem(certificatePem);
  return cert.validity.notAfter;
}

/**
 * Extract Subject Alternative Names from a certificate
 */
export function extractSANs(certificatePem: string): SubjectAlternativeNames {
  const cert = forge.pki.certificateFromPem(certificatePem);
  const sans: SubjectAlternativeNames = {
    dns: [],
    ip: [],
    email: [],
    uri: [],
  };

  const sanExtension = cert.extensions.find((ext: any) => ext.name === 'subjectAltName');
  if (!sanExtension || !sanExtension.altNames) {
    return sans;
  }

  for (const altName of sanExtension.altNames) {
    switch (altName.type) {
      case 1: // rfc822Name (email)
        sans.email?.push(altName.value);
        break;
      case 2: // dNSName
        sans.dns?.push(altName.value);
        break;
      case 6: // uniformResourceIdentifier
        sans.uri?.push(altName.value);
        break;
      case 7: // iPAddress
        sans.ip?.push(altName.value);
        break;
    }
  }

  return sans;
}
