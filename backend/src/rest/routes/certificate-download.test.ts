/**
 * Certificate Download Format Integration Tests
 *
 * Tests for GET /api/v1/certificates/:id/download endpoint with real KMS integration.
 * These tests require KMS to be running (docker compose up in kms/ directory).
 *
 * Tests validate:
 * 1. PEM format download
 * 2. DER format download
 * 3. Private key formats (key-pem, key-der, pkcs8-pem, pkcs8-der)
 * 4. Encrypted private key (pkcs8-encrypted)
 * 5. PKCS#12 bundle (p12/pfx)
 * 6. Full PEM (certificate + key)
 * 7. Chain PEM format
 * 8. Error cases (missing password, no key, etc.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import forge from 'node-forge';
import { registerRestApi } from '../index.js';
import { appRouter } from '../../trpc/router.js';
import { createContext } from '../../trpc/context.js';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Store created entity IDs for cleanup
const createdCaIds: string[] = [];
const createdCertIds: string[] = [];

/**
 * Integration tests for Certificate Download with real KMS
 */
describe('Certificate Download - KMS Integration', () => {
  let server: FastifyInstance;
  let testCaId: string;
  let testCertId: string;

  // Create server, CA, and certificate before all tests
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

    // Create a real CA and certificate using tRPC
    const randomString = Math.random().toString(36).substring(2, 8);

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Create a CA for issuing certificates
    const caResult = await caller.ca.create({
      subject: {
        commonName: `Download Test CA ${randomString.toUpperCase()}`,
        organization: 'Download Test Org',
        organizationalUnit: 'PKI Testing',
        country: 'US',
        state: 'California',
        locality: 'San Francisco',
      },
      keyAlgorithm: 'RSA-4096',
      validityYears: 10,
    });

    testCaId = caResult.id;
    createdCaIds.push(testCaId);

    console.log(`✅ Test CA created: ${testCaId}`);

    // Issue a certificate for download testing
    const certResult = await caller.certificate.issue({
      caId: testCaId,
      certificateType: 'server',
      subject: {
        commonName: `download-test-${randomString}.example.com`,
        organization: 'Download Test Server Org',
        country: 'US',
      },
      keyAlgorithm: 'RSA-4096',
      validityDays: 365,
      sanDns: [`download-test-${randomString}.example.com`],
    });

    testCertId = certResult.id;
    createdCertIds.push(testCertId);

    console.log(`✅ Test certificate issued: ${testCertId}`);
  });

  afterAll(async () => {
    // Clean up server
    await server.close();

    // Clean up all certificates created during tests
    for (const certId of createdCertIds) {
      await db.delete(certificates).where(eq(certificates.id, certId)).execute().catch(() => {});
    }
    // Clean up all CAs created during tests
    for (const caId of createdCaIds) {
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute().catch(() => {});
    }
    console.log('✅ Test cleanup complete');
  });

  describe('Certificate Format Downloads', () => {
    it('should download certificate in PEM format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=pem`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-pem-file');
      expect(body.filename).toContain('.crt');

      // Decode and verify it's a valid PEM certificate
      const pemContent = Buffer.from(body.data, 'base64').toString('utf-8');
      expect(pemContent).toMatch(/^-----BEGIN CERTIFICATE-----/);
      expect(pemContent).toMatch(/-----END CERTIFICATE-----$/);

      console.log('✅ PEM format download works');
    });

    it('should download certificate in DER format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=der`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-x509-ca-cert');
      expect(body.filename).toContain('.cer');

      // Verify it's valid base64 (DER is binary)
      const derBuffer = Buffer.from(body.data, 'base64');
      expect(derBuffer.length).toBeGreaterThan(0);

      console.log('✅ DER format download works');
    });

    it('should download certificate chain in PEM format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=chain-pem`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-pem-file');
      expect(body.filename).toContain('_chain.pem');

      console.log('✅ chain-pem format download works');
    });
  });

  describe('Private Key Format Downloads', () => {
    it('should download private key in PEM format (key-pem)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=key-pem`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-pem-file');
      expect(body.filename).toContain('.key');

      // Decode and verify it's a valid PEM private key
      const pemContent = Buffer.from(body.data, 'base64').toString('utf-8');
      expect(pemContent).toMatch(/-----BEGIN.*PRIVATE KEY-----/);
      expect(pemContent).toMatch(/-----END.*PRIVATE KEY-----/);

      console.log('✅ key-pem format download works');
    });

    it('should download private key in PKCS8 PEM format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=pkcs8-pem`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-pem-file');

      // Decode and verify it's a valid PEM private key
      const pemContent = Buffer.from(body.data, 'base64').toString('utf-8');
      expect(pemContent).toMatch(/-----BEGIN.*PRIVATE KEY-----/);

      console.log('✅ pkcs8-pem format download works');
    });

    it('should download private key in DER format (key-der)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=key-der`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/pkcs8');
      expect(body.filename).toContain('.key');

      // Verify it's valid base64 (DER is binary)
      const derBuffer = Buffer.from(body.data, 'base64');
      expect(derBuffer.length).toBeGreaterThan(0);

      console.log('✅ key-der format download works');
    });

    it('should download private key in PKCS8 DER format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=pkcs8-der`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/pkcs8');

      // Verify it's valid base64 (DER is binary)
      const derBuffer = Buffer.from(body.data, 'base64');
      expect(derBuffer.length).toBeGreaterThan(0);

      console.log('✅ pkcs8-der format download works');
    });

    it('should download encrypted private key with password (pkcs8-encrypted)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=pkcs8-encrypted&password=testpassword123`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-pem-file');
      expect(body.filename).toContain('_encrypted.key');

      // Decode and verify it's an encrypted PEM private key
      const pemContent = Buffer.from(body.data, 'base64').toString('utf-8');
      expect(pemContent).toMatch(/-----BEGIN.*ENCRYPTED.*PRIVATE KEY-----/);

      // Try to decrypt it with the password
      const privateKey = forge.pki.decryptRsaPrivateKey(pemContent, 'testpassword123');
      expect(privateKey).not.toBeNull();

      console.log('✅ pkcs8-encrypted format download works');
    });

    it('should require password for pkcs8-encrypted format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=pkcs8-encrypted`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PASSWORD_REQUIRED');

      console.log('✅ pkcs8-encrypted correctly requires password');
    });
  });

  describe('PKCS#12 Bundle Downloads', () => {
    it('should download PKCS#12 bundle (p12)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=p12&password=testpassword123`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-pkcs12');
      expect(body.filename).toContain('.p12');

      // Decode and verify it's a valid PKCS#12 structure
      const p12Der = forge.util.decode64(body.data);
      const p12Asn1 = forge.asn1.fromDer(p12Der);
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, 'testpassword123');

      // Verify it contains certificate and key
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
      const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });

      expect(certBags[forge.pki.oids.certBag]).toBeDefined();
      expect(certBags[forge.pki.oids.certBag]!.length).toBeGreaterThan(0);
      expect(keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]).toBeDefined();
      expect(keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]!.length).toBeGreaterThan(0);

      console.log('✅ p12 format download works');
    });

    it('should download PKCS#12 bundle (pfx alias)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=pfx&password=testpassword123`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-pkcs12');

      console.log('✅ pfx format download works (alias for p12)');
    });

    it('should require password for p12 format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=p12`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PASSWORD_REQUIRED');

      console.log('✅ p12 correctly requires password');
    });

    it('should require password for pfx format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=pfx`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PASSWORD_REQUIRED');

      console.log('✅ pfx correctly requires password');
    });
  });

  describe('Full PEM Downloads', () => {
    it('should download full PEM (certificate + key)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=full-pem`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-pem-file');
      expect(body.filename).toContain('_full.pem');

      // Decode and verify it contains both certificate and private key
      const pemContent = Buffer.from(body.data, 'base64').toString('utf-8');
      expect(pemContent).toMatch(/-----BEGIN CERTIFICATE-----/);
      expect(pemContent).toMatch(/-----END CERTIFICATE-----/);
      expect(pemContent).toMatch(/-----BEGIN.*PRIVATE KEY-----/);
      expect(pemContent).toMatch(/-----END.*PRIVATE KEY-----/);

      console.log('✅ full-pem format download works');
    });
  });

  describe('JKS Format', () => {
    it('should download JKS keystore format with certificate and private key', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=jks-keystore&password=testpassword123`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-java-keystore');
      expect(body.filename).toMatch(/-keystore\.jks$/);

      // Verify data is base64-encoded JKS
      const jksBuffer = Buffer.from(body.data, 'base64');
      // JKS files start with magic bytes 0xFEEDFEED (big-endian)
      expect(jksBuffer[0]).toBe(0xFE);
      expect(jksBuffer[1]).toBe(0xED);
      expect(jksBuffer[2]).toBe(0xFE);
      expect(jksBuffer[3]).toBe(0xED);

      console.log('✅ JKS keystore download works');
    });

    it('should download JKS keystore format without password (uses default changeit)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=jks-keystore`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-java-keystore');

      console.log('✅ JKS keystore with default password works');
    });

    it('should download JKS truststore format with CA certificate only', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=jks-truststore&password=testpassword123`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-java-keystore');
      expect(body.filename).toMatch(/-truststore\.jks$/);

      // Verify data is base64-encoded JKS - check the data length indicates it's a valid JKS file
      const jksBuffer = Buffer.from(body.data, 'base64');
      expect(jksBuffer.length).toBeGreaterThan(100); // JKS files have substantial size

      // JKS files start with magic bytes 0xFEEDFEED (big-endian)
      // Note: This verifies the file format is correct
      expect(jksBuffer[0]).toBe(0xFE);
      expect(jksBuffer[1]).toBe(0xED);
      expect(jksBuffer[2]).toBe(0xFE);
      expect(jksBuffer[3]).toBe(0xED);

      console.log('✅ JKS truststore download works');
    });

    it('should download JKS truststore format without password (uses default changeit)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=jks-truststore`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.mimeType).toBe('application/x-java-keystore');

      console.log('✅ JKS truststore with default password works');
    });
  });

  describe('Non-implemented Formats', () => {
    it('should return 400 for full-der format with P12 suggestion', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=full-der`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('USE_P12');
      expect(body.error.message).toContain('P12');

      console.log('✅ full-der returns 400 with P12 suggestion');
    });

    it('should return 400 for CSR format with explanation', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=csr-pem`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CSR_NOT_AVAILABLE');

      console.log('✅ csr-pem returns 400 with explanation');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent certificate', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/certificates/00000000-0000-0000-0000-000000000000/download?format=pem',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CERTIFICATE_NOT_FOUND');

      console.log('✅ 404 for non-existent certificate');
    });

    it('should return 400 for invalid format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download?format=invalid`,
      });

      expect(response.statusCode).toBe(400);

      console.log('✅ 400 for invalid format');
    });

    it('should return 400 when format is missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/certificates/${testCertId}/download`,
      });

      expect(response.statusCode).toBe(400);

      console.log('✅ 400 when format is missing');
    });
  });
});
