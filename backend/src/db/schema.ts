import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Certificate Authorities table
export const certificateAuthorities = sqliteTable(
  'certificate_authorities',
  {
    id: text('id').primaryKey(),
    subjectDn: text('subject_dn').notNull(),
    serialNumber: text('serial_number').notNull().unique(),
    keyAlgorithm: text('key_algorithm', {
      enum: ['RSA-2048', 'RSA-4096', 'ECDSA-P256', 'ECDSA-P384'],
    }).notNull(),
    notBefore: integer('not_before', { mode: 'timestamp' }).notNull(),
    notAfter: integer('not_after', { mode: 'timestamp' }).notNull(),
    kmsKeyId: text('kms_key_id').notNull(),
    kmsCertificateId: text('kms_certificate_id').notNull(),
    certificatePem: text('certificate_pem').notNull(),
    status: text('status', { enum: ['active', 'revoked', 'expired'] })
      .notNull()
      .default('active'),
    revocationDate: integer('revocation_date', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),
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
    algorithmIdx: index('idx_ca_algorithm').on(table.keyAlgorithm),
  })
);

// Certificates table
export const certificates = sqliteTable(
  'certificates',
  {
    id: text('id').primaryKey(),
    caId: text('ca_id')
      .notNull()
      .references(() => certificateAuthorities.id, { onDelete: 'cascade' }),
    subjectDn: text('subject_dn').notNull(),
    serialNumber: text('serial_number').notNull().unique(),
    certificateType: text('certificate_type', {
      enum: ['server', 'client', 'code_signing', 'email'],
    }).notNull(),
    notBefore: integer('not_before', { mode: 'timestamp' }).notNull(),
    notAfter: integer('not_after', { mode: 'timestamp' }).notNull(),
    certificatePem: text('certificate_pem').notNull(),
    kmsKeyId: text('kms_key_id'),
    status: text('status', { enum: ['active', 'revoked', 'expired'] })
      .notNull()
      .default('active'),
    revocationDate: integer('revocation_date', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),
    sanDns: text('san_dns'), // JSON array
    sanIp: text('san_ip'), // JSON array
    sanEmail: text('san_email'), // JSON array
    renewedFromId: text('renewed_from_id').references(() => certificates.id),
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
