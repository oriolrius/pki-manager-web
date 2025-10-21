/**
 * Types and interfaces for X.509 certificate generation
 */

/**
 * Supported key algorithms
 */
export type KeyAlgorithm = 'RSA-2048' | 'RSA-4096' | 'ECDSA-P256' | 'ECDSA-P384';

/**
 * Supported signature algorithms
 */
export type SignatureAlgorithm =
  | 'SHA256-RSA'
  | 'SHA384-RSA'
  | 'SHA512-RSA'
  | 'SHA256-ECDSA'
  | 'SHA384-ECDSA';

/**
 * Certificate serialization format
 */
export type CertificateFormat = 'PEM' | 'DER';

/**
 * Distinguished Name (DN) components
 */
export interface DistinguishedName {
  /** Common Name */
  CN?: string;
  /** Organization */
  O?: string;
  /** Organizational Unit */
  OU?: string;
  /** Country (2-letter code) */
  C?: string;
  /** State or Province */
  ST?: string;
  /** Locality */
  L?: string;
  /** Email Address */
  E?: string;
}

/**
 * Subject Alternative Name (SAN) types
 */
export interface SubjectAlternativeNames {
  /** DNS names */
  dns?: string[];
  /** IP addresses */
  ip?: string[];
  /** Email addresses */
  email?: string[];
  /** URIs */
  uri?: string[];
}

/**
 * Key Usage extension flags
 */
export interface KeyUsage {
  digitalSignature?: boolean;
  nonRepudiation?: boolean;
  keyEncipherment?: boolean;
  dataEncipherment?: boolean;
  keyAgreement?: boolean;
  keyCertSign?: boolean;
  cRLSign?: boolean;
  encipherOnly?: boolean;
  decipherOnly?: boolean;
}

/**
 * Extended Key Usage (EKU) purposes
 */
export type ExtendedKeyUsage =
  | 'serverAuth'
  | 'clientAuth'
  | 'codeSigning'
  | 'emailProtection'
  | 'timeStamping'
  | 'OCSPSigning';

/**
 * X.509 v3 Extensions
 */
export interface X509Extensions {
  /** Key Usage */
  keyUsage?: KeyUsage;
  /** Extended Key Usage */
  extendedKeyUsage?: ExtendedKeyUsage[];
  /** Subject Alternative Names */
  subjectAltName?: SubjectAlternativeNames;
  /** Basic Constraints */
  basicConstraints?: {
    cA: boolean;
    pathLenConstraint?: number;
  };
  /** Subject Key Identifier */
  subjectKeyIdentifier?: boolean;
  /** Authority Key Identifier */
  authorityKeyIdentifier?: boolean;
}

/**
 * Certificate generation parameters
 */
export interface CertificateParams {
  /** Subject Distinguished Name */
  subject: DistinguishedName;
  /** Issuer Distinguished Name (for CA-signed certs) */
  issuer?: DistinguishedName;
  /** Serial number (hex string or number) */
  serialNumber?: string | number;
  /** Validity period start date */
  notBefore?: Date;
  /** Validity period end date */
  notAfter?: Date;
  /** Subject's public key (PEM format) */
  publicKey: string;
  /** Issuer's private key for signing (PEM format) */
  signingKey?: string;
  /** Key algorithm */
  keyAlgorithm?: KeyAlgorithm;
  /** Signature algorithm */
  signatureAlgorithm?: SignatureAlgorithm;
  /** X.509 v3 extensions */
  extensions?: X509Extensions;
  /** Is this a self-signed certificate? */
  selfSigned?: boolean;
}

/**
 * CSR (Certificate Signing Request) parameters
 */
export interface CSRParams {
  /** Subject Distinguished Name */
  subject: DistinguishedName;
  /** Subject's public key (PEM format) */
  publicKey: string;
  /** Private key for signing the CSR (PEM format) */
  privateKey: string;
  /** Key algorithm */
  keyAlgorithm?: KeyAlgorithm;
  /** Signature algorithm */
  signatureAlgorithm?: SignatureAlgorithm;
  /** Requested extensions */
  extensions?: X509Extensions;
}

/**
 * CRL (Certificate Revocation List) entry
 */
export interface CRLEntry {
  /** Certificate serial number */
  serialNumber: string;
  /** Revocation date */
  revocationDate: Date;
  /** Revocation reason (optional) */
  reason?: CRLReason;
}

/**
 * CRL revocation reasons (RFC 5280)
 */
export enum CRLReason {
  UNSPECIFIED = 0,
  KEY_COMPROMISE = 1,
  CA_COMPROMISE = 2,
  AFFILIATION_CHANGED = 3,
  SUPERSEDED = 4,
  CESSATION_OF_OPERATION = 5,
  CERTIFICATE_HOLD = 6,
  REMOVE_FROM_CRL = 8,
  PRIVILEGE_WITHDRAWN = 9,
  AA_COMPROMISE = 10,
}

/**
 * CRL generation parameters
 */
export interface CRLParams {
  /** Issuer Distinguished Name */
  issuer: DistinguishedName;
  /** CRL number */
  crlNumber?: number;
  /** This update date */
  thisUpdate?: Date;
  /** Next update date */
  nextUpdate?: Date;
  /** Revoked certificates */
  revokedCertificates: CRLEntry[];
  /** Issuer's private key for signing (PEM format) */
  signingKey: string;
  /** Signature algorithm */
  signatureAlgorithm?: SignatureAlgorithm;
}

/**
 * Certificate generation result
 */
export interface GeneratedCertificate {
  /** Certificate in PEM format */
  pem: string;
  /** Certificate in DER format (Base64 encoded) */
  der: string;
  /** Serial number */
  serialNumber: string;
  /** Subject DN */
  subject: DistinguishedName;
  /** Issuer DN */
  issuer: DistinguishedName;
  /** Validity period */
  validity: {
    notBefore: Date;
    notAfter: Date;
  };
}

/**
 * CSR generation result
 */
export interface GeneratedCSR {
  /** CSR in PEM format */
  pem: string;
  /** CSR in DER format (Base64 encoded) */
  der: string;
  /** Subject DN */
  subject: DistinguishedName;
}

/**
 * CRL generation result
 */
export interface GeneratedCRL {
  /** CRL in PEM format */
  pem: string;
  /** CRL in DER format (Base64 encoded) */
  der: string;
  /** CRL number */
  crlNumber: number;
  /** Number of revoked certificates */
  revokedCount: number;
}
