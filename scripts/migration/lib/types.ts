/**
 * Documents of the migration. None of them holds private key material:
 * keys are identified by the SHA-256 of their DER SubjectPublicKeyInfo.
 */
import type { TransitKeyType } from './util.ts';

export const MANIFEST_FORMAT = 'pki-manager-openbao-migration-manifest/1';
export const APPROVAL_FORMAT = 'pki-manager-openbao-migration-approval/1';

/** Key classes, strictest last. A shared key takes the strictest class of its references. */
export type KeyClass = 'x509-leaf' | 'x509-ca' | 'ssh-ca' | 'scep-ra';
export const CLASS_RANK: Record<KeyClass, number> = { 'x509-leaf': 0, 'x509-ca': 1, 'ssh-ca': 2, 'scep-ra': 3 };

export type ReferenceRole =
  | 'x509-ca-key'          // certificate_authorities.kms_key_id
  | 'x509-leaf-key'        // certificates.kms_key_id
  | 'scep-ra-cert-alias'   // certificates.kms_key_id of an RA certificate (v3.19 writes the RA key id there)
  | 'ssh-ca-key'           // ssh_cas.kms_key_id
  | 'ssh-ca-public-key'    // ssh_cas.kms_public_key_id
  | 'ssh-cert-signer'      // ssh_certificates.kms_signing_key_id (history)
  | 'scep-ra-key'          // integration_ras.key_id (key_provider = cosmian)
  | 'scep-ra-public-key'   // integration_ras.public_key_id
  | 'scep-ra-openbao-key'; // integration_ras.key_id (key_provider = openbao)

export interface Reference {
  table: string;
  column: string;
  rowId: string;
  role: ReferenceRole;
  sourceId: string;
  /** Row status (active, revoked, retired, ...) when the table has one. */
  rowStatus?: string;
}

/**
 * transfer       wrapped transfer, same key (identity preserved)
 * already-target the key is already in OpenBao (verify only)
 * drop-key       keep the certificate rows, remove the key reference (no transfer)
 * rotate         cannot migrate: rotate with the documented procedure before cutover
 * history-only   referenced only by history rows; nothing to transfer
 */
export type Action = 'transfer' | 'already-target' | 'drop-key' | 'rotate' | 'history-only';

export interface SourceAttributes {
  objectType: string | null;
  state: string | null;
  sensitive: boolean | null;
  extractable: boolean | null;
  alwaysSensitive: boolean | null;
  neverExtractable: boolean | null;
}

export interface TargetSpec {
  mount: string;
  name: string;
  type: TransitKeyType;
  exportable: boolean;
  allowPkcs1v15SessionKey: boolean;
}

export interface KeyEntry {
  /** Canonical Cosmian private key id (a certificate id is resolved to its PrivateKeyLink). */
  sourceKeyId: string;
  class: KeyClass;
  references: Reference[];
  shared: boolean;
  /** Cosmian id of the linked public key (KMIP PublicKeyLink, or the row's public key column). */
  sourcePublicKeyId: string | null;
  /** Present when the KMS was read; null when unknown or missing. */
  attributes: SourceAttributes | null;
  missing: boolean;
  spkiSha256: string | null;
  sshFingerprint?: string;
  transitType: TransitKeyType | null;
  /** The actions the policy allows, and the one it proposes. */
  allowed: Action[];
  proposed: Action;
  reasons: string[];
  target: TargetSpec | null;
}

export interface CertificateEntry {
  table: 'certificate_authorities' | 'certificates' | 'integration_ras';
  rowId: string;
  serial: string;
  status: string;
  /** Where the PEM comes from: the database row, the Cosmian object, or nowhere. */
  pemSource: 'db' | 'kms' | 'missing' | 'unknown';
  pemSha256: string | null;
  spkiSha256: string | null;
  kmsCertificateId: string | null;
  /** The canonical key id of the row, when it has a key. */
  sourceKeyId: string | null;
  /** Certificate id of the issuer (the CA row's kms_certificate_id; itself for a CA). */
  issuerKmsCertificateId: string | null;
  /** How the certificate links to its key in the target: X.509 key rows, the RA key (no link), or none. */
  keyLink: 'x509' | 'ra-alias' | 'none';
}

export interface LegacyEntry {
  table: string;
  column: string;
  rowId: string;
  value: string;
  disposition: 'retire-legacy';
  note: string;
}

export interface Problem {
  severity: 'blocker' | 'warning';
  code: string;
  message: string;
  /** Canonical key id or `table:rowId`. */
  subject?: string;
}

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  createdAt: string;
  source: {
    dbFile: string;
    dbSha256: string;
    migrations: { count: number; lastCreatedAt: number | null };
    kmsRead: boolean;
    counts: Record<string, number>;
  };
  profile: { mounts: { x509: string; ssh: string; ra: string } };
  keys: KeyEntry[];
  certificates: CertificateEntry[];
  legacy: LegacyEntry[];
  problems: Problem[];
}

export interface ObjectApproval {
  action: Action;
  spkiSha256: string | null;
  /** Required for a key with Sensitive=true: the admin authorizes its wrapped transfer. */
  acknowledgeSensitive?: boolean;
  /** Optional tightening for exportable source keys; never true for a Sensitive source key. */
  exportable?: boolean;
}

export interface Approval {
  format: typeof APPROVAL_FORMAT;
  manifestSha256: string;
  approvedBy: string;
  approvedAt: string;
  target: { addr: string; wrappingKeys: Record<string, string> };
  /**
   * X.509 CA keys: `preserve` keeps the v3 export capability of an exportable
   * source key (CA keystore download still needs ALLOW_CA_KEY_EXPORT and an
   * admin), `deny` imports every CA key non-exportable (irreversible).
   */
  caKeyExport: 'preserve' | 'deny';
  /** The only source write: register the target wrapping public key(s) in Cosmian. */
  allowSourceWrappingKeyRegistration: boolean;
  /** Admin-approved offline material (wrapped blobs) instead of online wrapped export. */
  material?: Record<string, { file: string; sha256: string }>;
  keys: Record<string, ObjectApproval>;
  /** Certificate rows whose PEM is missing everywhere: kept without PEM only when listed. */
  acceptMissingPem?: string[];
}
