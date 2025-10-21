/**
 * X.509 Certificate Generation Utilities
 *
 * This module provides comprehensive utilities for generating and managing
 * X.509 certificates, CSRs, and CRLs with support for:
 * - Multiple key algorithms (RSA-2048, RSA-4096, ECDSA-P256, ECDSA-P384)
 * - X.509 v3 extensions (Key Usage, Extended Key Usage, Basic Constraints)
 * - Subject Alternative Names (DNS, IP, Email, URI)
 * - PEM and DER format serialization
 * - RFC 5280 compliance
 */

// Type exports
export type {
  KeyAlgorithm,
  SignatureAlgorithm,
  CertificateFormat,
  DistinguishedName,
  SubjectAlternativeNames,
  KeyUsage,
  ExtendedKeyUsage,
  X509Extensions,
  CertificateParams,
  CSRParams,
  CRLParams,
  CRLEntry,
  GeneratedCertificate,
  GeneratedCSR,
  GeneratedCRL,
} from './types.js';

export { CRLReason } from './types.js';

// Distinguished Name utilities
export {
  dnToForgeAttributes,
  forgeAttributesToDn,
  formatDN,
  parseDN,
  validateDN,
  isDNEqual,
  createSimpleDN,
  cloneDN,
} from './dn.js';

// Key utilities
export {
  parseKeyAlgorithm,
  getDefaultSignatureAlgorithm,
  parseSignatureAlgorithm,
  getForgeDigestAlgorithm,
  pemToForgeKey,
  forgeKeyToPem,
  validateKeyAlgorithm,
  generateSerialNumber,
  serialNumberToForge,
  validateSerialNumber,
} from './keys.js';

// Certificate generation and utilities
export {
  generateCertificate,
  parseCertificate,
  convertCertificateFormat,
  verifyCertificateSignature,
  isCertificateExpired,
  getCertificateExpiration,
  extractSANs,
} from './x509.js';

// CSR generation and utilities
export {
  generateCSR,
  parseCSR,
  verifyCSR,
  convertCSRFormat,
  extractCSRExtensions,
} from './csr.js';

// CRL generation and utilities
export {
  generateCRL,
  parseCRL,
  isCertificateRevoked,
  verifyCRL,
  convertCRLFormat,
  isCRLExpired,
  getCRLNextUpdate,
  countRevokedCertificates,
} from './crl.js';
