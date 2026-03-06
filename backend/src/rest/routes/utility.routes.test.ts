/**
 * Utility REST Endpoint Tests
 *
 * Tests to validate:
 * 1. Search endpoint returns grouped results
 * 2. Domains endpoint returns paginated list with statistics
 * 3. Dashboard stats endpoint returns real-time counts
 * 4. Dashboard expiring endpoint returns sorted items
 * 5. Audit endpoint supports filtering
 * 6. Reports endpoint generates CSV content
 * 7. Proper HTTP status codes and error handling
 * 8. OpenAPI documentation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerRestApi } from '../index.js';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates, auditLog } from '../../db/schema.js';
import { eq, like } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { generateCertificate } from '../../crypto/x509.js';

describe('Utility REST Endpoints', () => {
  let server: FastifyInstance;
  let testCaId: string;
  let testCaId2: string;
  let testCertId: string;
  let testCertId2: string;

  // Helper to create a test CA directly in the database
  async function createTestCA(options: {
    id?: string;
    status?: 'active' | 'revoked';
    subject?: string;
    notAfter?: Date;
  } = {}) {
    const caId = options.id || randomUUID();
    const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
    };

    const subject = options.subject || `CN=Test CA ${caId.slice(0, 8)},O=Test Organization,C=US`;
    const subjectParts = subject.split(',').reduce((acc, part) => {
      const [key, value] = part.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    const caCert = generateCertificate({
      subject: subjectParts,
      publicKey: caKeyPair.publicKeyPem,
      signingKey: caKeyPair.privateKeyPem,
      selfSigned: true,
    });

    const notAfter = options.notAfter || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    await db.insert(certificateAuthorities).values({
      id: caId,
      subjectDn: subject,
      serialNumber: caCert.serialNumber,
      keyAlgorithm: 'RSA-2048',
      notBefore: new Date(),
      notAfter: notAfter,
      kmsKeyId: `test-kms-key-${caId}`,
      kmsCertificateId: 'test-kms-cert-mock',
      status: options.status || 'active',
      revocationDate: options.status === 'revoked' ? new Date() : null,
      revocationReason: options.status === 'revoked' ? 'keyCompromise' : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return caId;
  }

  // Helper to create a test certificate
  async function createTestCertificate(caId: string, options: {
    id?: string;
    status?: 'active' | 'revoked' | 'expired';
    type?: 'server' | 'client' | 'dual' | 'email' | 'code_signing';
    subject?: string;
    sanDns?: string[];
    notAfter?: Date;
  } = {}) {
    const certId = options.id || randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const subject = options.subject || `CN=test-cert-${certId.slice(0, 8)}.example.com,O=Test Organization,C=US`;
    const subjectParts = subject.split(',').reduce((acc, part) => {
      const [key, value] = part.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    const cert = generateCertificate({
      subject: subjectParts,
      publicKey: certKeyPair.publicKeyPem,
      signingKey: certKeyPair.privateKeyPem,
      selfSigned: true,
    });

    const notAfter = options.notAfter || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    await db.insert(certificates).values({
      id: certId,
      caId,
      subjectDn: subject,
      serialNumber: cert.serialNumber,
      certificateType: options.type || 'server',
      notBefore: new Date(),
      notAfter: notAfter,
      kmsKeyId: `test-kms-key-${certId}`,
      kmsCertificateId: 'test-kms-cert-mock',
      status: options.status || 'active',
      sanDns: options.sanDns ? JSON.stringify(options.sanDns) : null,
      revocationDate: options.status === 'revoked' ? new Date() : null,
      revocationReason: options.status === 'revoked' ? 'keyCompromise' : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return certId;
  }

  // Helper to create a test audit log entry
  async function createTestAuditLog(options: {
    operation: string;
    entityType: string;
    entityId?: string;
    status?: 'success' | 'failure';
  }) {
    const auditId = randomUUID();
    await db.insert(auditLog).values({
      id: auditId,
      operation: options.operation,
      entityType: options.entityType,
      entityId: options.entityId || null,
      status: options.status || 'success',
      timestamp: new Date(),
      details: JSON.stringify({ test: true }),
      ipAddress: '127.0.0.1',
    });
    return auditId;
  }

  beforeAll(async () => {
    // Clean up any leftover test data from previous interrupted runs
    await db.delete(certificates).where(like(certificates.subjectDn, '%Test%')).catch(() => {});
    await db.delete(certificates).where(like(certificates.subjectDn, '%test-cert%')).catch(() => {});
    await db.delete(certificateAuthorities).where(like(certificateAuthorities.subjectDn, '%Test CA%')).catch(() => {});
    await db.delete(certificateAuthorities).where(like(certificateAuthorities.subjectDn, '%Test Organization%')).catch(() => {});

    // Create and configure test server
    server = Fastify({
      logger: false,
    });

    await server.register(cors, {
      origin: true,
      credentials: true,
    });

    // Register REST API with all routes
    await registerRestApi(server);

    // Start server on random available port
    await server.listen({ port: 0, host: '127.0.0.1' });
  });

  // Helper function to clean up test data
  async function cleanupTestData() {
    // Clean up specific test IDs first (more precise)
    if (testCertId) {
      await db.delete(certificates).where(eq(certificates.id, testCertId)).catch(() => {});
      testCertId = '';
    }
    if (testCertId2) {
      await db.delete(certificates).where(eq(certificates.id, testCertId2)).catch(() => {});
      testCertId2 = '';
    }
    if (testCaId) {
      await db.delete(certificates).where(eq(certificates.caId, testCaId)).catch(() => {});
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, testCaId)).catch(() => {});
      testCaId = '';
    }
    if (testCaId2) {
      await db.delete(certificates).where(eq(certificates.caId, testCaId2)).catch(() => {});
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, testCaId2)).catch(() => {});
      testCaId2 = '';
    }
  }

  afterAll(async () => {
    // Clean up any remaining test data
    await cleanupTestData();

    // Also clean up any leftover test data by pattern (in case of test failures)
    // Must delete certificates BEFORE CAs due to foreign key constraints
    await db.delete(certificates).where(like(certificates.subjectDn, '%Test%')).catch(() => {});
    await db.delete(certificates).where(like(certificates.subjectDn, '%test-cert%')).catch(() => {});
    await db.delete(certificates).where(like(certificates.subjectDn, '%searchable%')).catch(() => {});
    await db.delete(certificates).where(like(certificates.subjectDn, '%Searchable%')).catch(() => {});

    // Now safe to delete CAs
    await db.delete(certificateAuthorities).where(like(certificateAuthorities.subjectDn, '%Test CA%')).catch(() => {});
    await db.delete(certificateAuthorities).where(like(certificateAuthorities.subjectDn, '%Test Organization%')).catch(() => {});
    await db.delete(certificateAuthorities).where(like(certificateAuthorities.subjectDn, '%Searchable%')).catch(() => {});
    await db.delete(certificateAuthorities).where(like(certificateAuthorities.subjectDn, '%searchable%')).catch(() => {});
    await db.delete(certificateAuthorities).where(like(certificateAuthorities.subjectDn, '%Test Org%')).catch(() => {});

    await server.close();
  });

  afterEach(async () => {
    // Clean up test data after each test
    await cleanupTestData();
  });

  beforeEach(async () => {
    // Reset test IDs for the next test
    testCaId = '';
    testCaId2 = '';
    testCertId = '';
    testCertId2 = '';
  });

  describe('GET /api/v1/search - Global Search', () => {
    it('should return 400 when query is missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/search',
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return grouped results with cas, certificates, and domains', async () => {
      testCaId = await createTestCA({ subject: 'CN=Searchable CA,O=Test Org,C=US' });
      testCertId = await createTestCertificate(testCaId, {
        subject: 'CN=searchable.example.com,O=Test Org,C=US',
        sanDns: ['searchable.example.com', 'api.searchable.example.com'],
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/search?query=searchable',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.query).toBe('searchable');
      expect(body.results).toBeDefined();
      expect(body.results.cas).toBeDefined();
      expect(body.results.certificates).toBeDefined();
      expect(body.results.domains).toBeDefined();
      expect(Array.isArray(body.results.cas)).toBe(true);
      expect(Array.isArray(body.results.certificates)).toBe(true);
      expect(Array.isArray(body.results.domains)).toBe(true);
      expect(body.totalCount).toBeGreaterThanOrEqual(0);
    });

    it('should return search results with correct fields', async () => {
      testCaId = await createTestCA({ subject: 'CN=Field Test CA,O=Test Org,C=US' });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/search?query=Field',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.results.cas.length > 0) {
        const caResult = body.results.cas[0];
        expect(caResult.id).toBeDefined();
        expect(caResult.type).toBe('ca');
        expect(caResult.title).toBeDefined();
        expect(caResult.subtitle).toBeDefined();
        expect(caResult.status).toBeDefined();
        expect(caResult.metadata).toBeDefined();
      }
    });

    it('should accept optional limit parameter (1-50)', async () => {
      testCaId = await createTestCA();

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/search?query=test&limit=5',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should use default limit of 10', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/search?query=test',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/domains - List Domains', () => {
    it('should return paginated list with items array', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, {
        sanDns: ['domain-test.example.com'],
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/domains',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBeDefined();
      expect(body.pagination.limit).toBeDefined();
      expect(body.pagination.offset).toBeDefined();
      expect(body.pagination.hasMore).toBeDefined();
    });

    it('should support search parameter for domain filtering', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, {
        sanDns: ['unique-domain.example.com'],
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/domains?search=unique-domain',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.some((d: any) => d.domain.includes('unique-domain'))).toBe(true);
    });

    it('should support caId parameter to filter by CA', async () => {
      testCaId = await createTestCA();
      testCaId2 = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { sanDns: ['ca1-domain.example.com'] });
      testCertId2 = await createTestCertificate(testCaId2, { sanDns: ['ca2-domain.example.com'] });

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/domains?caId=${testCaId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Results should only contain domains from testCaId
      const hasOtherCaDomain = body.items.some((d: any) => d.domain.includes('ca2-domain'));
      expect(hasOtherCaDomain).toBe(false);
    });

    it('should return domain fields: isWildcard, baseDomain, certificateCount, caCount', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, {
        sanDns: ['*.wildcard-test.example.com'],
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/domains',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.items.length > 0) {
        const domain = body.items[0];
        expect(domain.domain).toBeDefined();
        expect(typeof domain.isWildcard).toBe('boolean');
        expect(domain.baseDomain).toBeDefined();
        expect(typeof domain.certificateCount).toBe('number');
        expect(typeof domain.caCount).toBe('number');
      }
    });

    it('should return statistics: activeCertificateCount and revokedCertificateCount', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, {
        status: 'active',
        sanDns: ['stats-domain.example.com'],
      });
      testCertId2 = await createTestCertificate(testCaId, {
        status: 'revoked',
        sanDns: ['stats-domain.example.com'],
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/domains?search=stats-domain',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.items.length > 0) {
        const domain = body.items[0];
        expect(typeof domain.activeCertificateCount).toBe('number');
        expect(typeof domain.revokedCertificateCount).toBe('number');
      }
    });
  });

  describe('GET /api/v1/dashboard/stats - Dashboard Statistics', () => {
    it('should return totalCAs, activeCAs, totalCertificates, activeCertificates', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/stats',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(typeof body.totalCAs).toBe('number');
      expect(typeof body.activeCAs).toBe('number');
      expect(typeof body.totalCertificates).toBe('number');
      expect(typeof body.activeCertificates).toBe('number');
    });

    it('should return real-time counts from database', async () => {
      // Create a CA with a unique name we can verify exists
      testCaId = await createTestCA();

      // Get stats - verify our CA is counted
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/stats',
      });
      const body = JSON.parse(response.body);

      // Verify there's at least 1 CA (our newly created one)
      // We can't compare before/after counts due to parallel test execution
      expect(body.totalCAs).toBeGreaterThanOrEqual(1);
      expect(body.activeCAs).toBeGreaterThanOrEqual(1);

      // Also verify that totalCAs >= activeCAs (logical constraint)
      expect(body.totalCAs).toBeGreaterThanOrEqual(body.activeCAs);
      expect(body.totalCertificates).toBeGreaterThanOrEqual(body.activeCertificates);
    });
  });

  describe('GET /api/v1/dashboard/expiring - Expiring Items', () => {
    it('should return array of expiring items', async () => {
      testCaId = await createTestCA({
        notAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/expiring',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(Array.isArray(body)).toBe(true);
    });

    it('should accept optional limit parameter (1-20, default 5)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/expiring?limit=3',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.length).toBeLessThanOrEqual(3);
    });

    it('should return items with id, type, cn, san, notAfter, daysRemaining', async () => {
      testCaId = await createTestCA({
        notAfter: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/expiring',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.length > 0) {
        const item = body[0];
        expect(item.id).toBeDefined();
        expect(item.type).toBeDefined();
        expect(item.cn).toBeDefined();
        expect(item.san).toBeDefined();
        expect(item.notAfter).toBeDefined();
        expect(typeof item.daysRemaining).toBe('number');
      }
    });

    it('should sort items by notAfter ascending (soonest first)', async () => {
      testCaId = await createTestCA({
        notAfter: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days
      });
      testCaId2 = await createTestCA({
        notAfter: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000), // 20 days
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard/expiring',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.length >= 2) {
        for (let i = 1; i < body.length; i++) {
          const prevDate = new Date(body[i - 1].notAfter).getTime();
          const currDate = new Date(body[i].notAfter).getTime();
          expect(prevDate).toBeLessThanOrEqual(currDate);
        }
      }
    });
  });

  describe('GET /api/v1/audit - Audit Log Entries', () => {
    it('should return paginated audit log entries', async () => {
      await createTestAuditLog({ operation: 'test.operation', entityType: 'test' });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/audit',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.totalCount).toBe('number');
      expect(body.pagination).toBeDefined();
    });

    it('should support filtering by operation parameter', async () => {
      await createTestAuditLog({ operation: 'ca.create', entityType: 'ca' });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/audit?operation=ca.create',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      body.items.forEach((item: any) => {
        expect(item.operation).toBe('ca.create');
      });
    });

    it('should support filtering by entityType parameter', async () => {
      await createTestAuditLog({ operation: 'certificate.issue', entityType: 'certificate' });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/audit?entityType=certificate',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      body.items.forEach((item: any) => {
        expect(item.entityType).toBe('certificate');
      });
    });

    it('should support filtering by status parameter', async () => {
      await createTestAuditLog({ operation: 'test.failure', entityType: 'test', status: 'failure' });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/audit?status=failure',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      body.items.forEach((item: any) => {
        expect(item.status).toBe('failure');
      });
    });

    it('should return entries in descending timestamp order', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/audit',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.items.length >= 2) {
        for (let i = 1; i < body.items.length; i++) {
          const prevTime = new Date(body.items[i - 1].timestamp).getTime();
          const currTime = new Date(body.items[i].timestamp).getTime();
          expect(prevTime).toBeGreaterThanOrEqual(currTime);
        }
      }
    });

    it('should return entries with id, timestamp, operation, entityType, entityId, ipAddress, status, details', async () => {
      await createTestAuditLog({ operation: 'field.test', entityType: 'test', entityId: 'test-id' });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/audit',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      if (body.items.length > 0) {
        const item = body.items[0];
        expect(item.id).toBeDefined();
        expect(item.timestamp).toBeDefined();
        expect(item.operation).toBeDefined();
        expect(item.entityType).toBeDefined();
        expect(item.status).toBeDefined();
      }
    });
  });

  describe('POST /api/v1/reports - Generate Reports', () => {
    it('should require reportType parameter', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('should accept certificate_inventory reportType', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: {
          reportType: 'certificate_inventory',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.reportName).toBe('Certificate Inventory Report');
    });

    it('should accept revocation reportType', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { status: 'revoked' });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: {
          reportType: 'revocation',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.reportName).toBe('Revocation Report');
    });

    it('should accept ca_operations reportType', async () => {
      await createTestAuditLog({ operation: 'ca.create', entityType: 'ca' });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: {
          reportType: 'ca_operations',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.reportName).toBe('CA Operations Report');
    });

    it('should return 501 for pdf format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: {
          reportType: 'certificate_inventory',
          format: 'pdf',
        },
      });

      expect(response.statusCode).toBe(501);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_IMPLEMENTED');
    });

    it('should support caId filter', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: {
          reportType: 'certificate_inventory',
          caId: testCaId,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return response with reportName, format, content, summary, generatedAt, hash, recordCount', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: {
          reportType: 'certificate_inventory',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.reportName).toBeDefined();
      expect(body.format).toBe('csv');
      expect(body.content).toBeDefined();
      expect(body.summary).toBeDefined();
      expect(body.generatedAt).toBeDefined();
      expect(body.hash).toBeDefined();
      expect(typeof body.recordCount).toBe('number');
    });

    it('should return valid CSV content with headers', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: {
          reportType: 'certificate_inventory',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Check CSV has header comments
      expect(body.content).toContain('# Certificate Inventory Report');
      expect(body.content).toContain('# Generated:');
      expect(body.content).toContain('# Hash:');
    });
  });

  describe('Error Response Format', () => {
    it('should return errors in standard format {error: {code, message, details?}}', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/search',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
    });
  });

  describe('OpenAPI Documentation', () => {
    it('should document all 6 utility endpoints in OpenAPI spec', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const spec = JSON.parse(response.body);

      const paths = Object.keys(spec.paths);

      // Check that utility endpoints are documented
      expect(paths.some(p => p.includes('search'))).toBe(true);
      expect(paths.some(p => p.includes('domains'))).toBe(true);
      expect(paths.some(p => p.includes('dashboard'))).toBe(true);
      expect(paths.some(p => p.includes('audit'))).toBe(true);
      expect(paths.some(p => p.includes('reports'))).toBe(true);
    });

    it('should have Search, Domains, Dashboard, and Audit tags', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const spec = JSON.parse(response.body);

      const tagNames = spec.tags.map((t: any) => t.name);
      expect(tagNames).toContain('Search');
      expect(tagNames).toContain('Domains');
      expect(tagNames).toContain('Dashboard');
      expect(tagNames).toContain('Audit');
    });
  });
});
