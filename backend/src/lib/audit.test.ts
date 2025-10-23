import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAuditLog, auditSuccess, auditFailure } from './audit.js';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

// Mock the database
const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
} as unknown as LibSQLDatabase<any>;

describe('Audit Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createAuditLog', () => {
    it('should create an audit log entry with all fields', async () => {
      const options = {
        db: mockDb,
        operation: 'ca.create' as const,
        entityType: 'ca' as const,
        entityId: 'ca-123',
        status: 'success' as const,
        details: {
          subject: 'CN=Test CA',
          keyAlgorithm: 'RSA-4096',
        },
        ipAddress: '127.0.0.1',
        kmsOperationId: 'kms-op-123',
      };

      const auditId = await createAuditLog(options);

      expect(auditId).toBeDefined();
      expect(typeof auditId).toBe('string');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should create an audit log entry with minimal fields', async () => {
      const options = {
        db: mockDb,
        operation: 'ca.list' as const,
        entityType: 'ca' as const,
        status: 'success' as const,
      };

      const auditId = await createAuditLog(options);

      expect(auditId).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should handle failures gracefully', async () => {
      const failingDb = {
        insert: vi.fn().mockRejectedValue(new Error('Database error')),
      } as unknown as LibSQLDatabase<any>;

      const options = {
        db: failingDb,
        operation: 'ca.create' as const,
        entityType: 'ca' as const,
        status: 'success' as const,
      };

      // Should not throw
      const auditId = await createAuditLog(options);
      expect(auditId).toBeDefined();
    });
  });

  describe('auditSuccess', () => {
    it('should create a success audit log entry', async () => {
      const auditId = await auditSuccess(
        mockDb,
        'certificate.issue',
        'certificate',
        'cert-123',
        { caId: 'ca-123', certificateType: 'server' },
        '192.168.1.1',
        'kms-456'
      );

      expect(auditId).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should create a success audit log without optional fields', async () => {
      const auditId = await auditSuccess(
        mockDb,
        'certificate.list',
        'certificate',
        'cert-list'
      );

      expect(auditId).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('auditFailure', () => {
    it('should create a failure audit log with Error object', async () => {
      const error = new Error('Test error');
      const auditId = await auditFailure(
        mockDb,
        'ca.create',
        'ca',
        'ca-123',
        error,
        { subject: 'CN=Test CA' },
        '10.0.0.1'
      );

      expect(auditId).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should create a failure audit log with string error', async () => {
      const auditId = await auditFailure(
        mockDb,
        'certificate.revoke',
        'certificate',
        'cert-123',
        'Custom error message'
      );

      expect(auditId).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should create a failure audit log without entity ID', async () => {
      const auditId = await auditFailure(
        mockDb,
        'ca.create',
        'ca',
        undefined,
        'Validation failed'
      );

      expect(auditId).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });
});
