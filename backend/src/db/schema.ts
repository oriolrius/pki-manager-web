import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
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
      enum: ['server', 'client', 'code_signing', 'email'],
    }).notNull(),
    notBefore: integer('not_before', { mode: 'timestamp' }).notNull(),
    notAfter: integer('not_after', { mode: 'timestamp' }).notNull(),

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

    // Certificate renewal tracking
    renewedFromId: text('renewed_from_id').references(() => certificates.id),

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

// Type exports for use in application code
export type CertificateAuthority = typeof certificateAuthorities.$inferSelect;
export type NewCertificateAuthority = typeof certificateAuthorities.$inferInsert;

export type Certificate = typeof certificates.$inferSelect;
export type NewCertificate = typeof certificates.$inferInsert;

export type Crl = typeof crls.$inferSelect;
export type NewCrl = typeof crls.$inferInsert;

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
