import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../db/client.js';
import { appRouter } from '../router.js';
import { createContext } from '../context.js';
import { createAuditLog } from '../../lib/audit.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

describe('Audit Router', () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(async () => {
    const mockReq = {
      ip: '127.0.0.1',
    } as FastifyRequest;
    const mockRes = {} as FastifyReply;

    const ctx = await createContext({ req: mockReq, res: mockRes });
    caller = appRouter.createCaller(ctx);

    // Create some test audit log entries
    await createAuditLog({
      db,
      operation: 'ca.create',
      entityType: 'ca',
      entityId: 'ca-test-1',
      status: 'success',
      details: {
        subject: 'CN=Test CA 1',
        keyAlgorithm: 'RSA-4096',
      },
      ipAddress: '127.0.0.1',
    });

    await createAuditLog({
      db,
      operation: 'certificate.issue',
      entityType: 'certificate',
      entityId: 'cert-test-1',
      status: 'success',
      details: {
        caId: 'ca-test-1',
        certificateType: 'server',
      },
      ipAddress: '192.168.1.1',
    });

    await createAuditLog({
      db,
      operation: 'ca.create',
      entityType: 'ca',
      entityId: 'ca-test-2',
      status: 'failure',
      details: {
        error: 'Validation failed',
      },
      ipAddress: '10.0.0.1',
    });
  });

  describe('audit.list', () => {
    it('should list all audit log entries', async () => {
      const result = await caller.audit.list({});

      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThanOrEqual(3);
      expect(result.totalCount).toBeGreaterThanOrEqual(3);
      expect(result.limit).toBe(100);
      expect(result.offset).toBe(0);
    });

    it('should filter by operation', async () => {
      const result = await caller.audit.list({
        operation: 'ca.create',
      });

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.items.every(item => item.operation === 'ca.create')).toBe(true);
    });

    it('should filter by entity type', async () => {
      const result = await caller.audit.list({
        entityType: 'certificate',
      });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.some(item => item.entityType === 'certificate')).toBe(true);
    });

    it('should filter by entity ID', async () => {
      const result = await caller.audit.list({
        entityId: 'ca-test-1',
      });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.some(item => item.entityId === 'ca-test-1')).toBe(true);
    });

    it('should filter by status', async () => {
      const result = await caller.audit.list({
        status: 'success',
      });

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.items.every(item => item.status === 'success')).toBe(true);
    });

    it('should filter by multiple criteria', async () => {
      const result = await caller.audit.list({
        operation: 'ca.create',
        status: 'success',
      });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.every(item =>
        item.operation === 'ca.create' && item.status === 'success'
      )).toBe(true);
    });

    it('should support pagination', async () => {
      const result = await caller.audit.list({
        limit: 2,
        offset: 0,
      });

      expect(result.items.length).toBeLessThanOrEqual(2);
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(0);
    });

    it('should return items in descending timestamp order', async () => {
      const result = await caller.audit.list({});

      for (let i = 1; i < result.items.length; i++) {
        const prevTimestamp = new Date(result.items[i - 1].timestamp).getTime();
        const currTimestamp = new Date(result.items[i].timestamp).getTime();
        expect(prevTimestamp).toBeGreaterThanOrEqual(currTimestamp);
      }
    });

    it('should parse details as JSON', async () => {
      const result = await caller.audit.list({
        entityId: 'ca-test-1',
      });

      expect(result.items[0].details).toBeDefined();
      expect(typeof result.items[0].details).toBe('object');
      expect(result.items[0].details).toHaveProperty('subject');
    });

    it('should include all required fields', async () => {
      const result = await caller.audit.list({
        limit: 1,
      });

      const log = result.items[0];
      expect(log).toHaveProperty('id');
      expect(log).toHaveProperty('timestamp');
      expect(log).toHaveProperty('operation');
      expect(log).toHaveProperty('entityType');
      expect(log).toHaveProperty('status');
    });
  });
});
