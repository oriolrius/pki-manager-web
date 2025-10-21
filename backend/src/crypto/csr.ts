/**
 * Certificate Signing Request (CSR) generation utilities
 */

import forge from 'node-forge';
import { logger } from '../lib/logger.js';
import { dnToForgeAttributes, forgeAttributesToDn, formatDN, validateDN } from './dn.js';
import { pemToForgeKey, getForgeDigestAlgorithm } from './keys.js';
import type {
  CSRParams,
  GeneratedCSR,
  X509Extensions,
  CertificateFormat,
  ExtendedKeyUsage,
} from './types.js';

/**
 * Add extension attributes to CSR
 */
function addCSRExtensions(csr: forge.pki.CertificationRequest, extensions?: X509Extensions): void {
  if (!extensions) {
    return;
  }

  const attrs: any[] = [];

  // Basic Constraints
  if (extensions.basicConstraints) {
    attrs.push({
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

    attrs.push(keyUsage);
  }

  // Extended Key Usage
  if (extensions.extendedKeyUsage && extensions.extendedKeyUsage.length > 0) {
    attrs.push({
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
      attrs.push({
        name: 'subjectAltName',
        altNames: altNames,
        critical: false,
      });
    }
  }

  // Add extension request attribute if there are any extensions
  if (attrs.length > 0) {
    csr.attributes.push({
      name: 'extensionRequest',
      extensions: attrs,
    });
  }
}

/**
 * Generate a Certificate Signing Request (CSR)
 */
export function generateCSR(params: CSRParams): GeneratedCSR {
  try {
    // Validate subject DN
    const validation = validateDN(params.subject);
    if (!validation.valid) {
      throw new Error(`Invalid subject DN: ${validation.errors.join(', ')}`);
    }

    // Create CSR
    const csr = forge.pki.createCertificationRequest();

    // Set version
    csr.version = 0; // PKCS#10 v1

    // Set subject
    csr.subject.attributes = dnToForgeAttributes(params.subject);

    // Set public key
    const publicKey = pemToForgeKey(params.publicKey, 'public');
    csr.publicKey = publicKey as forge.pki.rsa.PublicKey;

    // Add extensions if provided
    addCSRExtensions(csr, params.extensions);

    // Sign the CSR with the private key
    const privateKey = pemToForgeKey(params.privateKey, 'private');
    const signatureAlgorithm = params.signatureAlgorithm || 'SHA256-RSA';
    const digestAlgorithm = getForgeDigestAlgorithm(signatureAlgorithm);

    csr.sign(privateKey as forge.pki.rsa.PrivateKey, forge.md[digestAlgorithm].create());

    // Convert to PEM and DER
    const pem = forge.pki.certificationRequestToPem(csr);
    const der = forge.util.encode64(
      forge.asn1.toDer(forge.pki.certificationRequestToAsn1(csr)).getBytes(),
    );

    logger.info(
      {
        subject: formatDN(params.subject),
        hasExtensions: !!params.extensions,
      },
      'CSR generated',
    );

    return {
      pem,
      der,
      subject: forgeAttributesToDn(csr.subject.attributes),
    };
  } catch (error) {
    logger.error({ error, params }, 'Failed to generate CSR');
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`CSR generation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Parse a CSR from PEM or DER format
 */
export function parseCSR(
  data: string,
  format: CertificateFormat = 'PEM',
): {
  subject: any;
  publicKey: string;
  attributes: any[];
} {
  try {
    let csr: forge.pki.CertificationRequest;

    if (format === 'PEM') {
      csr = forge.pki.certificationRequestFromPem(data);
    } else {
      // DER format
      const derBytes = forge.util.decode64(data);
      const asn1 = forge.asn1.fromDer(derBytes);
      csr = forge.pki.certificationRequestFromAsn1(asn1);
    }

    const publicKeyPem = forge.pki.publicKeyToPem(csr.publicKey as forge.pki.rsa.PublicKey);

    return {
      subject: forgeAttributesToDn(csr.subject.attributes),
      publicKey: publicKeyPem,
      attributes: csr.attributes,
    };
  } catch (error) {
    throw new Error(`Failed to parse CSR: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Verify CSR signature
 */
export function verifyCSR(csrPem: string): boolean {
  try {
    const csr = forge.pki.certificationRequestFromPem(csrPem);
    return csr.verify();
  } catch (error) {
    logger.error({ error }, 'CSR verification failed');
    return false;
  }
}

/**
 * Convert CSR between PEM and DER formats
 */
export function convertCSRFormat(
  data: string,
  fromFormat: CertificateFormat,
  toFormat: CertificateFormat,
): string {
  if (fromFormat === toFormat) {
    return data;
  }

  try {
    let csr: forge.pki.CertificationRequest;

    if (fromFormat === 'PEM') {
      csr = forge.pki.certificationRequestFromPem(data);
    } else {
      const derBytes = forge.util.decode64(data);
      const asn1 = forge.asn1.fromDer(derBytes);
      csr = forge.pki.certificationRequestFromAsn1(asn1);
    }

    if (toFormat === 'PEM') {
      return forge.pki.certificationRequestToPem(csr);
    } else {
      return forge.util.encode64(
        forge.asn1.toDer(forge.pki.certificationRequestToAsn1(csr)).getBytes(),
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to convert CSR format: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Extract requested extensions from CSR
 */
export function extractCSRExtensions(csrPem: string): any[] {
  try {
    const csr = forge.pki.certificationRequestFromPem(csrPem);
    const extReq = csr.getAttribute({ name: 'extensionRequest' });

    if (!extReq || !extReq.extensions) {
      return [];
    }

    return extReq.extensions;
  } catch (error) {
    logger.error({ error }, 'Failed to extract CSR extensions');
    return [];
  }
}
