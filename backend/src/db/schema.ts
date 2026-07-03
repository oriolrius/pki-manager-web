import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  blob,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Certificate Authorities table (minimal schema - fetch cert/key data from KMS)
export const certificateAuthorities = sqliteTable(
  'certificate_authorities',
  {
    // Identity
    id: text('id').primaryKey(),

    // KMS references (essential)
    kmsCertificateId: text('kms_certificate_id').notNull(),
    kmsKeyId: text('kms_key_id').notNull(),

    // Query optimization fields (denormalized for performance)
    subjectDn: text('subject_dn').notNull(),
    serialNumber: text('serial_number').notNull().unique(),
    keyAlgorithm: text('key_algorithm'),
    notBefore: integer('not_before', { mode: 'timestamp' }).notNull(),
    notAfter: integer('not_after', { mode: 'timestamp' }).notNull(),

    // Application state (not in X.509 certificate)
    status: text('status', { enum: ['active', 'revoked', 'expired'] })
      .notNull()
      .default('active'),
    revocationDate: integer('revocation_date', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),

    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    serialIdx: index('idx_ca_serial').on(table.serialNumber),
    statusIdx: index('idx_ca_status').on(table.status),
    kmsCertIdx: index('idx_ca_kms_cert').on(table.kmsCertificateId),
  })
);

// Certificates table (minimal schema - fetch cert data from KMS)
export const certificates = sqliteTable(
  'certificates',
  {
    // Identity
    id: text('id').primaryKey(),

    // Relationships
    caId: text('ca_id')
      .notNull()
      .references(() => certificateAuthorities.id, { onDelete: 'cascade' }),

    // KMS references (essential)
    kmsCertificateId: text('kms_certificate_id').notNull(),
    kmsKeyId: text('kms_key_id'),

    // Query optimization fields (denormalized for performance)
    subjectDn: text('subject_dn').notNull(),
    serialNumber: text('serial_number').notNull().unique(),
    certificateType: text('certificate_type', {
      enum: ['server', 'client', 'dual', 'code_signing', 'email'],
    }).notNull(),
    notBefore: integer('not_before', { mode: 'timestamp' }).notNull(),
    notAfter: integer('not_after', { mode: 'timestamp' }).notNull(),

    // Source tracking (manual = UI/tRPC, k8s = via external issuer controller)
    sourceType: text('source_type', { enum: ['manual', 'k8s'] })
      .notNull()
      .default('manual'),
    k8sClusterId: text('k8s_cluster_id'),
    k8sNamespace: text('k8s_namespace'),
    k8sResource: text('k8s_resource'),
    requestUid: text('request_uid'),

    // Application state (not in X.509 certificate)
    status: text('status', { enum: ['active', 'revoked', 'expired'] })
      .notNull()
      .default('active'),
    revocationDate: integer('revocation_date', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),

    // SAN fields for quick filtering (denormalized)
    sanDns: text('san_dns'), // JSON array
    sanIp: text('san_ip'), // JSON array
    sanEmail: text('san_email'), // JSON array

    // Cached PEM (used for offline-signed certs whose KMS object is a placeholder)
    certificatePem: text('certificate_pem'),

    // Certificate renewal tracking
    renewedFromId: text('renewed_from_id').references((): AnySQLiteColumn => certificates.id),

    // Metadata
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    caIdIdx: index('idx_certificates_ca_id').on(table.caId),
    statusIdx: index('idx_certificates_status').on(table.status),
    serialIdx: index('idx_certificates_serial').on(table.serialNumber),
    typeIdx: index('idx_certificates_type').on(table.certificateType),
    kmsCertIdx: index('idx_cert_kms_cert').on(table.kmsCertificateId),
    sourceIdx: index('idx_certificates_source').on(table.sourceType),
    k8sClusterIdx: index('idx_certificates_k8s_cluster').on(table.k8sClusterId),
    requestUidIdx: index('idx_certificates_request_uid').on(table.requestUid),
  })
);

// K8s clusters registered to consume external issuer API
export const clusters = sqliteTable(
  'clusters',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    caId: text('ca_id')
      .notNull()
      .references(() => certificateAuthorities.id, { onDelete: 'restrict' }),
    // argon2 hash of bearer token. Token shown once on creation.
    tokenHash: text('token_hash').notNull(),
    // first 8 chars of plaintext token, for UI display (token_id_xxxx...)
    tokenPrefix: text('token_prefix').notNull(),
    createdBy: text('created_by'),
    lastSeen: integer('last_seen', { mode: 'timestamp' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    nameIdx: index('idx_clusters_name').on(table.name),
    caIdIdx: index('idx_clusters_ca_id').on(table.caId),
    prefixIdx: index('idx_clusters_token_prefix').on(table.tokenPrefix),
    revokedIdx: index('idx_clusters_revoked').on(table.revokedAt),
  })
);

// CRLs (Certificate Revocation Lists) table
export const crls = sqliteTable(
  'crls',
  {
    id: text('id').primaryKey(),
    caId: text('ca_id')
      .notNull()
      .references(() => certificateAuthorities.id, { onDelete: 'cascade' }),
    crlNumber: integer('crl_number').notNull(),
    thisUpdate: integer('this_update', { mode: 'timestamp' }).notNull(),
    nextUpdate: integer('next_update', { mode: 'timestamp' }).notNull(),
    crlPem: text('crl_pem').notNull(),
    revokedCount: integer('revoked_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    caIdIdx: index('idx_crls_ca_id').on(table.caId),
    crlNumberIdx: index('idx_crls_number').on(table.caId, table.crlNumber),
  })
);

// Audit Log table
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    timestamp: integer('timestamp', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    operation: text('operation').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    ipAddress: text('ip_address'),
    status: text('status', { enum: ['success', 'failure'] })
      .notNull()
      .default('success'),
    details: text('details'), // JSON blob
    kmsOperationId: text('kms_operation_id'),
  },
  (table) => ({
    timestampIdx: index('idx_audit_timestamp').on(table.timestamp),
    entityIdx: index('idx_audit_entity').on(table.entityType, table.entityId),
    operationIdx: index('idx_audit_operation').on(table.operation),
  })
);

// ============================================================================
// SSH Certificate Manager (milestone doc-006). OpenSSH certs are NOT X.509:
// no PEM/DN/SAN — OpenSSH-wire trust material, principals, extensions, KRLs.
// Minimal-schema: KMS holds private keys; SQLite holds metadata + the verbatim
// signed cert/KRL blobs (re-signing is non-deterministic, like crls.crl_pem).
// ============================================================================

// SSH Certificate Authorities — one ECDSA-P256 KMS keypair per role, no X.509 cert.
export const sshCas = sqliteTable(
  'ssh_cas',
  {
    id: text('id').primaryKey(),
    caType: text('ca_type', { enum: ['user', 'host'] }).notNull(),
    label: text('label'),
    // KMS references (the private key never leaves the KMS — decision-011).
    kmsKeyId: text('kms_key_id').notNull(),
    kmsPublicKeyId: text('kms_public_key_id').notNull(),
    // Published trust material.
    opensshPublicKey: text('openssh_public_key').notNull(),
    fingerprintSha256: text('fingerprint_sha256').notNull(),
    keyAlgorithm: text('key_algorithm').notNull().default('ECDSA-P256'),
    // Per-CA monotonic serial allocator (SQLite INTEGER is signed 64-bit;
    // covers the practical OpenSSH serial range).
    nextSerial: integer('next_serial').notNull().default(1),
    // Lifecycle + rotation (SSH-32a): one active + one rotating per type.
    status: text('status', { enum: ['active', 'rotating', 'retired'] })
      .notNull()
      .default('active'),
    predecessorCaId: text('predecessor_ca_id').references((): AnySQLiteColumn => sshCas.id),
    retireAfter: integer('retire_after', { mode: 'timestamp' }),
    revocationDate: integer('revocation_date', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    caTypeIdx: index('idx_ssh_cas_type').on(table.caType),
    statusIdx: index('idx_ssh_cas_status').on(table.status),
    fpIdx: index('idx_ssh_cas_fp').on(table.fingerprintSha256),
    oneActivePerType: uniqueIndex('uq_ssh_cas_active_type')
      .on(table.caType)
      .where(sql`status = 'active'`),
    oneRotatingPerType: uniqueIndex('uq_ssh_cas_rotating_type')
      .on(table.caType)
      .where(sql`status = 'rotating'`),
  })
);

// SSH hosts — host-cert subjects + KRL/principal distribution telemetry.
export const sshHosts = sqliteTable(
  'ssh_hosts',
  {
    id: text('id').primaryKey(),
    fqdn: text('fqdn').notNull().unique(),
    displayName: text('display_name'),
    addresses: text('addresses'), // JSON string[] — host-cert principals
    opensshHostPubkey: text('openssh_host_pubkey'),
    hostKeyAlgorithm: text('host_key_algorithm'),
    kmsPubkeyId: text('kms_pubkey_id'), // set only when the ECIES path registers it
    currentCertId: text('current_cert_id'), // logical pointer (no hard FK — avoids cycle)
    status: text('status', { enum: ['pending', 'active', 'offboarded'] })
      .notNull()
      .default('pending'),
    enrolledAt: integer('enrolled_at', { mode: 'timestamp' }),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
    // Distribution telemetry (SSH-22 serving / SSH-24 puller callback / SSH-14 drift).
    lastKrlVersion: text('last_krl_version'),
    lastKrlFetchAt: integer('last_krl_fetch_at', { mode: 'timestamp' }),
    lastPrincipalPushAt: integer('last_principal_push_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    statusIdx: index('idx_ssh_hosts_status').on(table.status),
    kmsPubkeyIdx: index('idx_ssh_hosts_kms_pubkey').on(table.kmsPubkeyId),
  })
);

// SSH identities — user-cert subjects (subject = the audit key-id seed).
export const sshIdentities = sqliteTable(
  'ssh_identities',
  {
    id: text('id').primaryKey(),
    subject: text('subject').notNull().unique(),
    externalSubject: text('external_subject'), // OIDC sub, optional
    email: text('email'),
    opensshUserPubkey: text('openssh_user_pubkey'),
    pubkeySource: text('pubkey_source', { enum: ['uploaded', 'kms', 'per_request'] })
      .notNull()
      .default('per_request'),
    kmsPubkeyId: text('kms_pubkey_id'),
    status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    statusIdx: index('idx_ssh_identities_status').on(table.status),
    extSubIdx: index('idx_ssh_identities_ext_sub').on(table.externalSubject),
  })
);

// SSH certificates — issued host & user OpenSSH certs (polymorphic).
export const sshCertificates = sqliteTable(
  'ssh_certificates',
  {
    id: text('id').primaryKey(),
    caId: text('ca_id')
      .notNull()
      .references(() => sshCas.id, { onDelete: 'cascade' }),
    certType: text('cert_type', { enum: ['host', 'user'] }).notNull(),
    hostId: text('host_id').references(() => sshHosts.id, { onDelete: 'set null' }),
    identityId: text('identity_id').references(() => sshIdentities.id, { onDelete: 'set null' }),
    serial: text('serial').notNull(), // uint64 as TEXT
    keyId: text('key_id').notNull(), // the -I audit anchor, denormalized
    principals: text('principals').notNull(), // JSON string[]
    validAfter: integer('valid_after', { mode: 'timestamp' }).notNull(),
    validBefore: integer('valid_before', { mode: 'timestamp' }).notNull(),
    extensions: text('extensions'), // JSON string[]
    criticalOptions: text('critical_options'), // JSON object
    certOpenssh: text('cert_openssh').notNull(), // verbatim signed *-cert.pub
    subjectPubkeyFingerprint: text('subject_pubkey_fingerprint').notNull(),
    kmsSigningKeyId: text('kms_signing_key_id').notNull(),
    status: text('status', { enum: ['active', 'revoked', 'expired'] }).notNull().default('active'),
    revocationDate: integer('revocation_date', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),
    sourceType: text('source_type', { enum: ['manual', 'automation'] }).notNull().default('manual'),
    supersededBy: text('superseded_by').references((): AnySQLiteColumn => sshCertificates.id),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    caSerialUq: uniqueIndex('uq_ssh_certs_ca_serial').on(table.caId, table.serial),
    caIdIdx: index('idx_ssh_certs_ca').on(table.caId),
    statusIdx: index('idx_ssh_certs_status').on(table.status),
    typeIdx: index('idx_ssh_certs_type').on(table.certType),
    hostIdx: index('idx_ssh_certs_host').on(table.hostId),
    identityIdx: index('idx_ssh_certs_identity').on(table.identityId),
    keyIdIdx: index('idx_ssh_certs_keyid').on(table.keyId),
    fpIdx: index('idx_ssh_certs_fp').on(table.subjectPubkeyFingerprint),
  })
);

// RBAC catalog — role-principals (the picklist / source of truth).
export const sshPrincipals = sqliteTable('ssh_principals', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Which principals an identity's certs may carry.
export const sshUserPrincipals = sqliteTable(
  'ssh_user_principals',
  {
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => sshIdentities.id, { onDelete: 'cascade' }),
    principalId: text('principal_id')
      .notNull()
      .references(() => sshPrincipals.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    uq: uniqueIndex('uq_ssh_user_principals').on(table.identityId, table.principalId),
    identityIdx: index('idx_ssh_user_principals_identity').on(table.identityId),
  })
);

// Per-host principal -> local-account mapping (rendered into AuthorizedPrincipalsFile).
export const sshHostPrincipalMaps = sqliteTable(
  'ssh_host_principal_maps',
  {
    id: text('id').primaryKey(),
    hostId: text('host_id')
      .notNull()
      .references(() => sshHosts.id, { onDelete: 'cascade' }),
    principalId: text('principal_id')
      .notNull()
      .references(() => sshPrincipals.id, { onDelete: 'restrict' }),
    localAccount: text('local_account').notNull(),
  },
  (table) => ({
    uq: uniqueIndex('uq_ssh_host_principal_maps').on(table.hostId, table.principalId, table.localAccount),
    hostIdx: index('idx_ssh_host_principal_maps_host').on(table.hostId),
  })
);

// Revocation directives (cert / serial / key-hash / key-id).
export const sshRevocations = sqliteTable(
  'ssh_revocations',
  {
    id: text('id').primaryKey(),
    caId: text('ca_id')
      .notNull()
      .references(() => sshCas.id, { onDelete: 'cascade' }),
    targetType: text('target_type', {
      enum: ['cert', 'serial', 'key_fingerprint', 'key_id'],
    }).notNull(),
    certId: text('cert_id').references(() => sshCertificates.id, { onDelete: 'set null' }),
    serial: text('serial'), // uint64 as TEXT
    keyFingerprint: text('key_fingerprint'),
    keyId: text('key_id'),
    reason: text('reason'),
    revokedBy: text('revoked_by'),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    caIdx: index('idx_ssh_revocations_ca').on(table.caId),
    certIdx: index('idx_ssh_revocations_cert').on(table.certId),
  })
);

// KRL state — bare unsigned KRL (what sshd reads) + a distinct detached CA signature.
export const sshKrls = sqliteTable(
  'ssh_krls',
  {
    id: text('id').primaryKey(),
    caId: text('ca_id')
      .notNull()
      .references(() => sshCas.id, { onDelete: 'cascade' }),
    krlNumber: integer('krl_number').notNull(),
    versionHash: text('version_hash').notNull(), // 'sha256:<hex>' (ETag)
    krlBlob: blob('krl_blob', { mode: 'buffer' }).notNull(), // bare unsigned OpenSSH KRL
    caSignature: blob('ca_signature', { mode: 'buffer' }), // detached DER sig (puller-only)
    thisUpdate: integer('this_update', { mode: 'timestamp' }).notNull(),
    nextUpdate: integer('next_update', { mode: 'timestamp' }).notNull(),
    revokedCount: integer('revoked_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    caNumberIdx: index('idx_ssh_krls_ca_number').on(table.caId, table.krlNumber),
    versionIdx: index('idx_ssh_krls_version').on(table.versionHash),
  })
);

// Per-host user access blocks (BLK-02, decision-016) — "block THIS identity on
// THIS host". NOT revocations: the blocked identity's certs stay active (valid
// everywhere else); resolution into deny entries happens at per-host KRL build
// time. Lifted rows are kept for audit; FKs are RESTRICT because hosts and
// identities are soft-state (offboarded/disabled), never hard-deleted while
// referenced.
export const sshHostBlocks = sqliteTable(
  'ssh_host_blocks',
  {
    id: text('id').primaryKey(),
    hostId: text('host_id')
      .notNull()
      .references(() => sshHosts.id, { onDelete: 'restrict' }),
    identityId: text('identity_id')
      .notNull()
      .references(() => sshIdentities.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    status: text('status', { enum: ['active', 'lifted'] }).notNull().default('active'),
    createdBy: text('created_by'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    liftedBy: text('lifted_by'),
    liftedAt: integer('lifted_at', { mode: 'timestamp' }),
  },
  (table) => ({
    hostIdx: index('idx_ssh_host_blocks_host').on(table.hostId),
    identityIdx: index('idx_ssh_host_blocks_identity').on(table.identityId),
    // One ACTIVE block per (host, identity); lifted history preserved
    // (uq_ssh_cas_active_type partial-unique pattern).
    oneActivePair: uniqueIndex('uq_ssh_host_blocks_active_pair')
      .on(table.hostId, table.identityId)
      .where(sql`status = 'active'`),
  })
);

// Per-host composed KRL lineage (BLK-02, decision-016) — mirrors ssh_krls but
// keyed by host: host-CA set ∪ user-CA sets ∪ resolved active blocks.
// krl_number comes from the GLOBAL ssh_krl_seq allocator (shared with the
// per-CA lineage) so a host switched between lineages always sees strictly
// increasing signed header numbers (pinned req #4). The UNIQUE index is a
// tripwire behind the allocator, not the allocation mechanism.
export const sshHostKrls = sqliteTable(
  'ssh_host_krls',
  {
    id: text('id').primaryKey(),
    hostId: text('host_id')
      .notNull()
      .references(() => sshHosts.id, { onDelete: 'restrict' }),
    krlNumber: integer('krl_number').notNull(),
    versionHash: text('version_hash').notNull(), // 'sha256:<hex>' (ETag)
    krlBlob: blob('krl_blob', { mode: 'buffer' }).notNull(), // bare unsigned OpenSSH KRL
    caSignature: blob('ca_signature', { mode: 'buffer' }), // detached DER sig (Host-CA key; puller-only)
    thisUpdate: integer('this_update', { mode: 'timestamp' }).notNull(),
    nextUpdate: integer('next_update', { mode: 'timestamp' }).notNull(),
    revokedCount: integer('revoked_count').notNull().default(0),
    blockCount: integer('block_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    hostNumberUq: uniqueIndex('uq_ssh_host_krls_host_number').on(table.hostId, table.krlNumber),
    versionIdx: index('idx_ssh_host_krls_version').on(table.versionHash),
    hostIdx: index('idx_ssh_host_krls_host').on(table.hostId),
  })
);

// Single-row global KRL-number allocator shared by BOTH lineages (per-CA and
// per-host). Seeded by the migration from max(ssh_krls.krl_number); allocation
// is one atomic UPDATE ... RETURNING (src/db/krl-seq.ts). Immune to future
// pruning of old KRL rows (a max()-based allocator would regress and the
// client would reject the next KRL as rollback). Gaps are harmless — the
// puller only requires strictly-newer.
export const sshKrlSeq = sqliteTable('ssh_krl_seq', {
  id: integer('id').primaryKey(),
  value: integer('value').notNull(),
});

// SSH automation fleet tokens (SSH-19) — bearer tokens for the Ansible/CI
// external signing API. Stored only as a SHA-256 hash; one token scoped to a
// CA pair + op-set. Plaintext (pkimg_…) is shown exactly once at mint time.
export const sshFleetTokens = sqliteTable(
  'ssh_fleet_tokens',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(), // display only, e.g. pkimg_ab12…
    userCaId: text('user_ca_id').references(() => sshCas.id, { onDelete: 'set null' }),
    hostCaId: text('host_ca_id').references(() => sshCas.id, { onDelete: 'set null' }),
    opSet: text('op_set').notNull(), // JSON string[]: sign-host | sign-user | register-host-pubkey
    revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
    lastSeenIp: text('last_seen_ip'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    hashIdx: uniqueIndex('uq_ssh_fleet_tokens_hash').on(table.tokenHash),
  })
);

// Idempotency cache for external signing (SSH-19).
export const sshIdempotency = sqliteTable('ssh_idempotency', {
  key: text('key').primaryKey(), // token-scoped Idempotency-Key
  tokenId: text('token_id'),
  certId: text('cert_id'),
  response: text('response').notNull(), // cached JSON response
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// Type exports for use in application code
export type CertificateAuthority = typeof certificateAuthorities.$inferSelect;
export type NewCertificateAuthority = typeof certificateAuthorities.$inferInsert;

export type Certificate = typeof certificates.$inferSelect;
export type NewCertificate = typeof certificates.$inferInsert;

export type Crl = typeof crls.$inferSelect;
export type NewCrl = typeof crls.$inferInsert;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;

export type Cluster = typeof clusters.$inferSelect;
export type NewCluster = typeof clusters.$inferInsert;

// --- SSH Certificate Manager types ---
export type SshCa = typeof sshCas.$inferSelect;
export type NewSshCa = typeof sshCas.$inferInsert;
export type SshHost = typeof sshHosts.$inferSelect;
export type NewSshHost = typeof sshHosts.$inferInsert;
export type SshIdentity = typeof sshIdentities.$inferSelect;
export type NewSshIdentity = typeof sshIdentities.$inferInsert;
export type SshCertificate = typeof sshCertificates.$inferSelect;
export type NewSshCertificate = typeof sshCertificates.$inferInsert;
export type SshPrincipal = typeof sshPrincipals.$inferSelect;
export type NewSshPrincipal = typeof sshPrincipals.$inferInsert;
export type SshUserPrincipal = typeof sshUserPrincipals.$inferSelect;
export type NewSshUserPrincipal = typeof sshUserPrincipals.$inferInsert;
export type SshHostPrincipalMap = typeof sshHostPrincipalMaps.$inferSelect;
export type NewSshHostPrincipalMap = typeof sshHostPrincipalMaps.$inferInsert;
export type SshRevocation = typeof sshRevocations.$inferSelect;
export type NewSshRevocation = typeof sshRevocations.$inferInsert;
export type SshKrl = typeof sshKrls.$inferSelect;
export type NewSshKrl = typeof sshKrls.$inferInsert;
export type SshFleetToken = typeof sshFleetTokens.$inferSelect;
export type NewSshFleetToken = typeof sshFleetTokens.$inferInsert;
export type SshHostBlock = typeof sshHostBlocks.$inferSelect;
export type NewSshHostBlock = typeof sshHostBlocks.$inferInsert;
export type SshHostKrl = typeof sshHostKrls.$inferSelect;
export type NewSshHostKrl = typeof sshHostKrls.$inferInsert;
