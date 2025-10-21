/**
 * KMIP JSON TTLV Types for Cosmian KMS
 * Based on KMIP 2.1 specification
 */

export type KMIPValueType =
  | "Structure"
  | "Integer"
  | "LongInteger"
  | "BigInteger"
  | "Enumeration"
  | "Boolean"
  | "TextString"
  | "ByteString"
  | "DateTime"
  | "Interval";

export interface KMIPElement {
  tag: string;
  type?: KMIPValueType;
  value: unknown;
}

export interface KMIPRequest {
  tag: string;
  value: KMIPElement[];
}

export interface KMIPResponse {
  tag: string;
  value: KMIPElement[];
}

// Common KMIP attributes
export interface KMIPAttribute {
  tag: "Attribute";
  value: KMIPElement[];
}

// Cryptographic algorithms
export type CryptographicAlgorithm = "RSA" | "EC" | "AES" | "CoverCrypt";

export type KeyFormatType =
  | "Raw"
  | "Opaque"
  | "PKCS1"
  | "PKCS8"
  | "X509"
  | "ECPrivateKey"
  | "TransparentSymmetricKey"
  | "TransparentDSAPrivateKey"
  | "TransparentDSAPublicKey"
  | "TransparentRSAPrivateKey"
  | "TransparentRSAPublicKey"
  | "TransparentDHPrivateKey"
  | "TransparentDHPublicKey"
  | "TransparentECDSAPrivateKey"
  | "TransparentECDSAPublicKey"
  | "TransparentECDHPrivateKey"
  | "TransparentECDHPublicKey";

export type ObjectType = "Certificate" | "SymmetricKey" | "PublicKey" | "PrivateKey" | "SplitKey" | "Template" | "SecretData" | "OpaqueObject";

export type State = "PreActive" | "Active" | "Deactivated" | "Compromised" | "Destroyed" | "Destroyed_Compromised";

// Operation-specific types
export interface CreateKeyPairRequest extends KMIPRequest {
  tag: "CreateKeyPair";
}

export interface CreateKeyPairResponse extends KMIPResponse {
  tag: "CreateKeyPairResponse";
}

export interface GetRequest extends KMIPRequest {
  tag: "Get";
}

export interface GetResponse extends KMIPResponse {
  tag: "GetResponse";
}

export interface DestroyRequest extends KMIPRequest {
  tag: "Destroy";
}

export interface DestroyResponse extends KMIPResponse {
  tag: "DestroyResponse";
}

export interface RevokeRequest extends KMIPRequest {
  tag: "Revoke";
}

export interface RevokeResponse extends KMIPResponse {
  tag: "RevokeResponse";
}

export interface CertifyRequest extends KMIPRequest {
  tag: "Certify";
}

export interface CertifyResponse extends KMIPResponse {
  tag: "CertifyResponse";
}

// Helper type for key pair result
export interface KeyPairIds {
  privateKeyId: string;
  publicKeyId: string;
}

// Helper type for certificate info
export interface CertificateInfo {
  certificateId: string;
  certificateData: string; // PEM or DER encoded
}

// Error types
export interface KMIPError {
  message: string;
  code?: string;
  details?: unknown;
}
