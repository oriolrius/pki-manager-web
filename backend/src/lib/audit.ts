import { randomUUID } from 'crypto';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { auditLog } from '../db/schema.js';
import { logger } from './logger.js';

export type AuditOperation =
  // CA operations
  | 'ca.create'
  | 'ca.revoke'
  | 'ca.delete'
  | 'ca.list'
  | 'ca.getById'
  // Certificate operations
  | 'certificate.issue'
  | 'certificate.renew'
  | 'certificate.revoke'
  | 'certificate.delete'
  | 'certificate.download'
  | 'certificate.list'
  | 'certificate.getById'
  // CRL operations
  | 'crl.generate'
  | 'crl.publish'
  | 'crl.getLatest'
  | 'crl.getHistory'
  // Audit operations
  | 'audit.list'
  | 'audit.export';

export type AuditEntityType = 'ca' | 'certificate' | 'crl' | 'audit' | 'system';

export interface AuditLogOptions {
  db: LibSQLDatabase<any>;
  operation: AuditOperation;
  entityType: AuditEntityType;
  entityId?: string;
  status: 'success' | 'failure';
  details?: Record<string, any>;
  ipAddress?: string;
  kmsOperationId?: string;
}

/**
 * Create an audit log entry in the database.
 * This function ensures consistent audit logging across all operations.
 */
export async function createAuditLog(options: AuditLogOptions): Promise<string> {
  const {
    db,
    operation,
    entityType,
    entityId,
    status,
    details,
    ipAddress,
    kmsOperationId,
  } = options;

  const auditId = randomUUID();

  try {
    await db.insert(auditLog).values({
      id: auditId,
      operation,
      entityType,
      entityId: entityId || null,
      status,
      details: details ? JSON.stringify(details) : null,
      ipAddress: ipAddress || null,
      kmsOperationId: kmsOperationId || null,
    });

    logger.debug(
      {
        auditId,
        operation,
        entityType,
        entityId,
        status,
      },
      'Audit log entry created'
    );

    return auditId;
  } catch (error) {
    logger.error(
      {
        error,
        operation,
        entityType,
        entityId,
      },
      'Failed to create audit log entry'
    );
    // Don't throw - audit logging failures should not break the main operation
    return auditId;
  }
}

/**
 * Helper function to create audit log for successful operations
 */
export async function auditSuccess(
  db: LibSQLDatabase<any>,
  operation: AuditOperation,
  entityType: AuditEntityType,
  entityId: string,
  details?: Record<string, any>,
  ipAddress?: string,
  kmsOperationId?: string
): Promise<string> {
  return createAuditLog({
    db,
    operation,
    entityType,
    entityId,
    status: 'success',
    details,
    ipAddress,
    kmsOperationId,
  });
}

/**
 * Helper function to create audit log for failed operations
 */
export async function auditFailure(
  db: LibSQLDatabase<any>,
  operation: AuditOperation,
  entityType: AuditEntityType,
  entityId: string | undefined,
  error: Error | string,
  details?: Record<string, any>,
  ipAddress?: string
): Promise<string> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return createAuditLog({
    db,
    operation,
    entityType,
    entityId,
    status: 'failure',
    details: {
      ...details,
      error: errorMessage,
    },
    ipAddress,
  });
}
