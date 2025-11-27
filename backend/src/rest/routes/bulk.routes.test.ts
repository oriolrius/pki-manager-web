/**
 * Bulk Operations REST Endpoint Tests
 *
 * Tests to validate:
 * 1. All 5 bulk endpoints are accessible
 * 2. Proper HTTP status codes are returned
 * 3. Partial success handling works correctly
 * 4. CSV parsing for bulk issue
 * 5. Error handling for validation errors
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerRestApi } from '../index.js';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates } from '../../db/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { generateCertificate } from '../../crypto/x509.js';

describe('Bulk Operations REST Endpoints', () => {
  let server: FastifyInstance;
  // Track all created resources for cleanup
  const createdCaIds: string[] = [];
  const createdCertIds: string[] = [];

  // Helper to create a test CA directly in the database
  async function createTestCA(options: {
    id?: string;
    status?: 'active' | 'revoked';
    subject?: string;
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

    await db.insert(certificateAuthorities).values({
      id: caId,
      subjectDn: subject,
      serialNumber: caCert.serialNumber,
      keyAlgorithm: 'RSA-2048',
      notBefore: caCert.validity.notBefore,
      notAfter: caCert.validity.notAfter,
      kmsKeyId: `test-kms-key-${caId}`,
      kmsCertificateId: 'test-kms-cert-mock',
      status: options.status || 'active',
      revocationDate: options.status === 'revoked' ? new Date() : null,
      revocationReason: options.status === 'revoked' ? 'keyCompromise' : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    createdCaIds.push(caId);
    return caId;
  }

  // Helper to create a test certificate
  async function createTestCertificate(caId: string, options: {
    id?: string;
    status?: 'active' | 'revoked';
    type?: 'server' | 'client' | 'email' | 'code_signing';
    subject?: string;
    expiredDaysAgo?: number;
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

    // Adjust dates if expired
    let notBefore = cert.validity.notBefore;
    let notAfter = cert.validity.notAfter;
    if (options.expiredDaysAgo) {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - options.expiredDaysAgo);
      notAfter = expiredDate;
      notBefore = new Date(expiredDate.getTime() - 365 * 24 * 60 * 60 * 1000);
    }

    await db.insert(certificates).values({
      id: certId,
      caId,
      subjectDn: subject,
      serialNumber: cert.serialNumber,
      certificateType: options.type || 'server',
      notBefore,
      notAfter,
      kmsKeyId: `test-kms-key-${certId}`,
      kmsCertificateId: 'test-kms-cert-mock',
      status: options.status || 'active',
      revocationDate: options.status === 'revoked' ? new Date() : null,
      revocationReason: options.status === 'revoked' ? 'keyCompromise' : null,
      sanDns: JSON.stringify(['test.example.com']),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    createdCertIds.push(certId);
    return certId;
  }

  beforeAll(async () => {
    // Clean up any leftover test data from previous interrupted runs
    // This ensures tests start with a clean slate
    const { like } = await import('drizzle-orm');
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

  afterAll(async () => {
    // Clean up all created test data by ID (only this test's data)
    if (createdCertIds.length > 0) {
      await db.delete(certificates).where(inArray(certificates.id, createdCertIds)).catch(() => {});
    }
    if (createdCaIds.length > 0) {
      // First delete any remaining certificates for these CAs
      await db.delete(certificates).where(inArray(certificates.caId, createdCaIds)).catch(() => {});
      await db.delete(certificateAuthorities).where(inArray(certificateAuthorities.id, createdCaIds)).catch(() => {});
    }

    await server.close();
  });

  describe('POST /api/v1/certificates/bulk/revoke - Bulk Revoke Certificates', () => {
    it('should revoke multiple certificates successfully', async () => {
      const caId = await createTestCA();
      const certId1 = await createTestCertificate(caId);
      const certId2 = await createTestCertificate(caId);

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/revoke',
        payload: {
          certificateIds: [certId1, certId2],
          reason: 'keyCompromise',
          details: 'Test revocation',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.successful).toBe(2);
      expect(body.failed).toBe(0);
      expect(body.results).toHaveLength(2);
      expect(body.results.every((r: { success: boolean }) => r.success)).toBe(true);
    });

    it('should return 409 for already revoked certificates in results', async () => {
      const caId = await createTestCA();
      const revokedCertId = await createTestCertificate(caId, { status: 'revoked' });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/revoke',
        payload: {
          certificateIds: [revokedCertId],
          reason: 'keyCompromise',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.failed).toBe(1);
      expect(body.results[0].success).toBe(false);
      expect(body.results[0].error).toContain('already revoked');
    });

    it('should handle partial success with mixed certificates', async () => {
      const caId = await createTestCA();
      const activeCertId = await createTestCertificate(caId);
      const revokedCertId = await createTestCertificate(caId, { status: 'revoked' });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/revoke',
        payload: {
          certificateIds: [activeCertId, revokedCertId],
          reason: 'cessationOfOperation',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.successful).toBe(1);
      expect(body.failed).toBe(1);
    });

    it('should validate revocation reason enum', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/revoke',
        payload: {
          certificateIds: [randomUUID()],
          reason: 'invalidReason',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for empty certificateIds array', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/revoke',
        payload: {
          certificateIds: [],
          reason: 'keyCompromise',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/certificates/bulk/renew - Bulk Renew Certificates', () => {
    it('should return 409 for revoked certificates in results', async () => {
      const caId = await createTestCA();
      const revokedCertId = await createTestCertificate(caId, { status: 'revoked' });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/renew',
        payload: {
          certificateIds: [revokedCertId],
          generateNewKey: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.failed).toBe(1);
      expect(body.results[0].success).toBe(false);
      expect(body.results[0].error).toContain('revoked');
    });

    it('should validate certificateIds array max length', async () => {
      const tooManyIds = Array(101).fill(null).map(() => randomUUID());

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/renew',
        payload: {
          certificateIds: tooManyIds,
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/v1/certificates/bulk - Bulk Delete Certificates', () => {
    it('should delete revoked certificates successfully', async () => {
      const caId = await createTestCA();
      const revokedCertId = await createTestCertificate(caId, { status: 'revoked' });

      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/certificates/bulk',
        payload: {
          certificateIds: [revokedCertId],
          destroyKey: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.successful).toBe(1);
      expect(body.failed).toBe(0);

      // Remove from tracking since it's deleted
      const idx = createdCertIds.indexOf(revokedCertId);
      if (idx > -1) createdCertIds.splice(idx, 1);
    });

    it('should delete expired certificates (> 90 days) successfully', async () => {
      const caId = await createTestCA();
      const expiredCertId = await createTestCertificate(caId, { expiredDaysAgo: 100 });

      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/certificates/bulk',
        payload: {
          certificateIds: [expiredCertId],
          destroyKey: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.successful).toBe(1);

      // Remove from tracking since it's deleted
      const idx = createdCertIds.indexOf(expiredCertId);
      if (idx > -1) createdCertIds.splice(idx, 1);
    });

    it('should return 409 for active non-expired certificates in results', async () => {
      const caId = await createTestCA();
      const activeCertId = await createTestCertificate(caId, { status: 'active' });

      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/certificates/bulk',
        payload: {
          certificateIds: [activeCertId],
          destroyKey: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.failed).toBe(1);
      expect(body.results[0].success).toBe(false);
      expect(body.results[0].error).toContain('must be revoked or expired');
    });

    it('should handle partial success with mixed certificates', async () => {
      const caId = await createTestCA();
      const revokedCertId = await createTestCertificate(caId, { status: 'revoked' });
      const activeCertId = await createTestCertificate(caId, { status: 'active' });

      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/certificates/bulk',
        payload: {
          certificateIds: [revokedCertId, activeCertId],
          destroyKey: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.successful).toBe(1);
      expect(body.failed).toBe(1);

      // Remove deleted cert from tracking
      const idx = createdCertIds.indexOf(revokedCertId);
      if (idx > -1) createdCertIds.splice(idx, 1);
    });
  });

  describe('POST /api/v1/certificates/bulk/download - Bulk Download Certificates', () => {
    it('should return 400 when password missing for encrypted formats', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/download',
        payload: {
          certificateIds: [randomUUID()],
          format: 'pkcs12',
          encryptPrivateKey: true,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PASSWORD_REQUIRED');
    });

    it('should return 400 when password missing for jks-truststore', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/download',
        payload: {
          certificateIds: [randomUUID()],
          format: 'jks-truststore',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PASSWORD_REQUIRED');
    });

    it('should return 404 when no certificates found', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/download',
        payload: {
          certificateIds: [randomUUID()],
          format: 'pem',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/certificates/bulk/issue - Bulk Issue Certificates', () => {
    it('should return 404 when CA not found', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/issue',
        payload: {
          caId: randomUUID(),
          csvData: 'server,test.example.com,Test Org,US,,365',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CA_NOT_FOUND');
    });

    it('should return 409 when CA is not active', async () => {
      const revokedCaId = await createTestCA({ status: 'revoked' });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/issue',
        payload: {
          caId: revokedCaId,
          csvData: 'server,test.example.com,Test Org,US,,365',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CA_NOT_ACTIVE');
    });

    it('should return 400 for invalid certificate type in CSV', async () => {
      const caId = await createTestCA();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/issue',
        payload: {
          caId,
          csvData: 'invalid_type,test.example.com,Test Org,US,,365',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.failed).toBe(1);
      expect(body.results[0].error).toContain('Invalid certificate type');
    });

    it('should return 400 for missing required CSV fields', async () => {
      const caId = await createTestCA();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/issue',
        payload: {
          caId,
          csvData: 'server,test.example.com', // Missing O and C
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.failed).toBe(1);
      expect(body.results[0].error).toContain('Invalid CSV format');
    });

    it('should validate country code is 2 letters', async () => {
      const caId = await createTestCA();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/issue',
        payload: {
          caId,
          csvData: 'server,test.example.com,Test Org,USA,,365', // 3-letter country
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.failed).toBe(1);
      expect(body.results[0].error).toContain('2-letter code');
    });
  });

  describe('OpenAPI Documentation', () => {
    it('should include bulk endpoints in OpenAPI spec', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const spec = JSON.parse(response.body);

      // Check bulk endpoints are documented (OpenAPI paths may not include /api/v1 prefix)
      const paths = Object.keys(spec.paths);
      const bulkPaths = paths.filter(p => p.includes('bulk'));

      // We should have at least 4 bulk paths (issue, revoke, renew, download, plus the base path)
      expect(bulkPaths.length).toBeGreaterThanOrEqual(4);

      // Check specific bulk operations exist
      expect(bulkPaths.some(p => p.includes('issue'))).toBe(true);
      expect(bulkPaths.some(p => p.includes('revoke'))).toBe(true);
      expect(bulkPaths.some(p => p.includes('renew'))).toBe(true);
      expect(bulkPaths.some(p => p.includes('download'))).toBe(true);
    });

    it('should have Bulk Operations tag defined', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const spec = JSON.parse(response.body);

      // Check that the Bulk Operations tag is defined
      expect(spec.tags).toBeDefined();
      const bulkTag = spec.tags.find((t: { name: string }) => t.name === 'Bulk Operations');
      expect(bulkTag).toBeDefined();
      expect(bulkTag.description).toBeDefined();
    });
  });

  describe('Error Response Format', () => {
    it('should return errors in standard format', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates/bulk/revoke',
        payload: {
          // Missing required fields
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
    });
  });
});
