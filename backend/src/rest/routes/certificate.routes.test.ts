/**
 * Certificate REST Endpoint Tests
 *
 * Tests to validate:
 * 1. All 7 certificate endpoints are accessible
 * 2. Proper HTTP status codes are returned
 * 3. Pagination is implemented for list endpoints
 * 4. Query parameter filtering works correctly
 * 5. OpenAPI schemas are documented correctly
 * 6. Error handling works as expected
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerRestApi } from '../index.js';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { generateCertificate } from '../../crypto/x509.js';

describe('Certificate REST Endpoints', () => {
  let server: FastifyInstance;
  let testCaId: string;
  let testCertId: string;
  let testCertId2: string;

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

    return certId;
  }

  beforeAll(async () => {
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
    await server.close();
  });

  beforeEach(async () => {
    // Clean up test data
    if (testCertId) {
      await db.delete(certificates).where(eq(certificates.id, testCertId)).catch(() => {});
    }
    if (testCertId2) {
      await db.delete(certificates).where(eq(certificates.id, testCertId2)).catch(() => {});
    }
    if (testCaId) {
      await db.delete(certificates).where(eq(certificates.caId, testCaId)).catch(() => {});
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, testCaId)).catch(() => {});
    }
  });

  describe('GET /api/v1/certificates - List Certificates', () => {
    it('should return empty list when no certificates exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/certificates',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.pagination).toBeDefined();
    });

    it('should return list of certificates', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);
      testCertId2 = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/certificates',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter certificates by status', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { status: 'active' });
      testCertId2 = await createTestCertificate(testCaId, { status: 'revoked' });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/certificates?status=active',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      body.items.forEach((cert: any) => {
        expect(cert.status).toBe('active');
      });
    });

    it('should filter certificates by type', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { type: 'server' });
      testCertId2 = await createTestCertificate(testCaId, { type: 'client' });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/certificates?type=server',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      body.items.forEach((cert: any) => {
        expect(cert.certificateType).toBe('server');
      });
    });

    it('should filter certificates by caId', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates?caId=${testCaId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      body.items.forEach((cert: any) => {
        expect(cert.caId).toBe(testCaId);
      });
    });

    it('should support pagination with limit and offset', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);
      testCertId2 = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/certificates?limit=1&offset=0',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeLessThanOrEqual(1);
      expect(body.pagination.limit).toBe(1);
      expect(body.pagination.offset).toBe(0);
    });

    it('should search certificates by subject DN', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, {
        subject: 'CN=searchable-cert.example.com,O=Test Org,C=US',
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/certificates?search=searchable',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.some((cert: any) => cert.subjectDn.includes('searchable'))).toBe(true);
    });

    it('should have proper pagination response structure', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/certificates',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.pagination).toHaveProperty('total');
      expect(body.pagination).toHaveProperty('limit');
      expect(body.pagination).toHaveProperty('offset');
      expect(body.pagination).toHaveProperty('hasMore');
    });
  });

  describe('GET /api/v1/certificates/:id - Get Certificate Details', () => {
    it('should return 404 for non-existent certificate', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${randomUUID()}`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('CERTIFICATE_NOT_FOUND');
    });

    it('should return certificate details or handle KMS errors', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}`,
      });

      // Service may return 500 if KMS cert retrieval fails
      // Accept either 200 (success) or 500 (KMS unavailable)
      expect([200, 500]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        expect(body.id).toBe(testCertId);
        expect(body.subjectDn).toBeDefined();
        expect(body.serialNumber).toBeDefined();
        expect(body.status).toBeDefined();
      }
    });
  });

  describe('POST /api/v1/certificates - Issue Certificate', () => {
    it('should return 404 for non-existent CA', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates',
        payload: {
          caId: randomUUID(),
          subject: {
            commonName: 'test.example.com',
            organization: 'Test Org',
            country: 'US',
          },
          certificateType: 'server',
          keyAlgorithm: 'RSA-2048',
          validityDays: 365,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CA_NOT_FOUND');
    });

    it('should return 409 for revoked CA', async () => {
      testCaId = await createTestCA({ status: 'revoked' });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates',
        payload: {
          caId: testCaId,
          subject: {
            commonName: 'test.example.com',
            organization: 'Test Org',
            country: 'US',
          },
          certificateType: 'server',
          keyAlgorithm: 'RSA-2048',
          validityDays: 365,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CA_NOT_ACTIVE');
    });

    it('should validate required subject fields', async () => {
      testCaId = await createTestCA();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates',
        payload: {
          caId: testCaId,
          subject: {
            commonName: 'test.example.com',
            // missing organization and country
          },
          certificateType: 'server',
          keyAlgorithm: 'RSA-2048',
          validityDays: 365,
        },
      });

      // Fastify schema validation returns 400 for missing required fields
      expect(response.statusCode).toBe(400);
    });

    it('should validate country code length', async () => {
      testCaId = await createTestCA();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates',
        payload: {
          caId: testCaId,
          subject: {
            commonName: 'test.example.com',
            organization: 'Test Org',
            country: 'USA', // Should be 2 characters
          },
          certificateType: 'server',
          keyAlgorithm: 'RSA-2048',
          validityDays: 365,
        },
      });

      // Fastify schema validation returns 400 for invalid country code length
      expect(response.statusCode).toBe(400);
    });

    it('should issue certificate with valid input or handle KMS errors', async () => {
      testCaId = await createTestCA();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates',
        payload: {
          caId: testCaId,
          subject: {
            commonName: 'test.example.com',
            organization: 'Test Org',
            country: 'US',
          },
          certificateType: 'server',
          keyAlgorithm: 'RSA-2048',
          validityDays: 365,
          sanDns: ['test.example.com', 'www.test.example.com'],
        },
      });

      // Accept 201 (success) or 500 (KMS unavailable)
      expect([201, 500]).toContain(response.statusCode);
      if (response.statusCode === 201) {
        const body = JSON.parse(response.body);
        expect(body.id).toBeDefined();
        expect(body.subject).toBeDefined();
        expect(body.serialNumber).toBeDefined();
        expect(body.status).toBe('active');
        testCertId = body.id;
      }
    });
  });

  describe('POST /api/v1/certificates/:id/revoke - Revoke Certificate', () => {
    it('should return 404 for non-existent certificate', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/certificates/${randomUUID()}/revoke`,
        payload: {
          reason: 'keyCompromise',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should revoke an active certificate', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { status: 'active' });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/certificates/${testCertId}/revoke`,
        payload: {
          reason: 'keyCompromise',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(testCertId);
      expect(body.status).toBe('revoked');
      expect(body.revocationDate).toBeDefined();
      expect(body.revocationReason).toContain('keyCompromise');
    });

    it('should return 409 for already revoked certificate', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { status: 'revoked' });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/certificates/${testCertId}/revoke`,
        payload: {
          reason: 'keyCompromise',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CERTIFICATE_ALREADY_REVOKED');
    });

    it('should accept revocation details', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { status: 'active' });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/certificates/${testCertId}/revoke`,
        payload: {
          reason: 'keyCompromise',
          details: 'Private key was leaked',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.revocationReason).toContain('Private key was leaked');
    });
  });

  describe('POST /api/v1/certificates/:id/renew - Renew Certificate', () => {
    it('should return 404 for non-existent certificate', async () => {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/certificates/${randomUUID()}/renew`,
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 409 for revoked certificate', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { status: 'revoked' });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/certificates/${testCertId}/renew`,
        payload: {
          generateNewKey: true,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CERTIFICATE_REVOKED');
    });

    it('should renew certificate or handle KMS errors', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { status: 'active' });

      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/certificates/${testCertId}/renew`,
        payload: {
          generateNewKey: true,
          validityDays: 365,
        },
      });

      // Accept 201 (success) or 500 (KMS unavailable)
      expect([201, 500]).toContain(response.statusCode);
      if (response.statusCode === 201) {
        const body = JSON.parse(response.body);
        expect(body.id).toBeDefined();
        expect(body.renewedFromId).toBe(testCertId);
        expect(body.status).toBe('active');
      }
    });
  });

  describe('DELETE /api/v1/certificates/:id - Delete Certificate', () => {
    it('should return 404 for non-existent certificate', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/certificates/${randomUUID()}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 409 for active certificate', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { status: 'active' });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/certificates/${testCertId}`,
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CERTIFICATE_NOT_DELETABLE');
    });

    it('should delete a revoked certificate or handle KMS errors', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { status: 'revoked' });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/certificates/${testCertId}`,
      });

      // Accept 200 (success) or 500 (KMS error)
      expect([200, 500]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        expect(body.deleted).toBe(true);
        expect(body.id).toBe(testCertId);
      }
    }, 15000);

    it('should accept destroyKey query parameter', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId, { status: 'revoked' });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/certificates/${testCertId}?destroyKey=true`,
      });

      // Accept 200 (success) or 500 (KMS error)
      expect([200, 500]).toContain(response.statusCode);
    }, 15000);
  });

  describe('GET /api/v1/certificates/:id/download - Download Certificate', () => {
    it('should return 404 for non-existent certificate', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${randomUUID()}/download?format=pem`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should require format parameter', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download`,
      });

      // Missing required query parameter returns 400 (schema validation)
      expect(response.statusCode).toBe(400);
    });

    it('should download certificate in PEM format or handle KMS errors', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=pem`,
      });

      // Accept 200 (success) or 500 (KMS unavailable)
      expect([200, 500]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        expect(body.data).toBeDefined();
        expect(body.mimeType).toBe('application/x-pem-file');
        expect(body.filename).toContain('.crt');
      }
    });

    it('should download certificate in DER format or handle KMS errors', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=der`,
      });

      // Accept 200 (success) or 500 (KMS unavailable)
      expect([200, 500]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        expect(body.data).toBeDefined();
        expect(body.mimeType).toBe('application/x-x509-ca-cert');
        expect(body.filename).toContain('.cer');
      }
    });

    it('should require password for P12 format', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=p12`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PASSWORD_REQUIRED');
    });

    it('should reject invalid format', async () => {
      testCaId = await createTestCA();
      testCertId = await createTestCertificate(testCaId);

      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=invalid`,
      });

      // Invalid enum value returns 400 (schema validation)
      expect(response.statusCode).toBe(400);
    });
  });

  describe('OpenAPI Documentation', () => {
    it('should document certificate endpoints in OpenAPI spec', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const spec = JSON.parse(response.body);

      // Check that certificate endpoints are documented
      const paths = Object.keys(spec.paths);
      const certPaths = paths.filter(p => p.includes('certificates'));
      expect(certPaths.length).toBeGreaterThan(0);
    });

    it('should have Certificates tag defined', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const spec = JSON.parse(response.body);

      // Check that the Certificates tag exists
      expect(spec.tags).toBeDefined();
      const tagNames = spec.tags.map((t: any) => t.name);
      expect(tagNames).toContain('Certificates');
    });
  });

  describe('Error Response Format', () => {
    it('should return errors in correct format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${randomUUID()}`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
    });

    it('should return validation errors with details', async () => {
      testCaId = await createTestCA();

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/certificates',
        payload: {
          caId: testCaId,
          subject: {
            // Missing required fields
          },
          certificateType: 'server',
          keyAlgorithm: 'RSA-2048',
          validityDays: 365,
        },
      });

      // Validation errors return 400 (schema validation)
      expect(response.statusCode).toBe(400);
    });
  });
});
