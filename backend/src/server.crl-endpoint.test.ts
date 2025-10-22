/**
 * CRL HTTP Endpoint Tests
 *
 * Tests to validate:
 * 1. CRL endpoint is accessible without authentication
 * 2. Proper HTTP headers are set (Content-Type, Cache-Control, etc.)
 * 3. Both PEM (.crl) and DER (.der) formats are supported
 * 4. 404 handling for non-existent CAs
 * 5. Proper error handling
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { db } from './db/client.js';
import { certificateAuthorities, crls } from './db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { generateCertificate } from './crypto/x509.js';

describe('CRL HTTP Endpoint', () => {
  let server: FastifyInstance;
  let testCaId: string;
  let testCrlId: string;

  beforeAll(async () => {
    // Create test CA and CRL
    testCaId = randomUUID();
    testCrlId = randomUUID();

    const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
    };

    const caCert = generateCertificate({
      subject: { CN: 'Test CA for HTTP', O: 'Test Org', C: 'US' },
      publicKey: caKeyPair.publicKeyPem,
      signingKey: caKeyPair.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: testCaId,
      subjectDn: 'CN=Test CA for HTTP,O=Test Org,C=US',
      serialNumber: caCert.serialNumber,
      keyAlgorithm: 'RSA-2048',
      notBefore: caCert.validity.notBefore,
      notAfter: caCert.validity.notAfter,
      kmsKeyId: 'test-kms-key-http',
      certificatePem: caCert.pem,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create a test CRL with mock PEM data
    const mockCrlPem = `-----BEGIN X509 CRL-----
MIIBpzCBkAIBATANBgkqhkiG9w0BAQsFADBBMQswCQYDVQQGEwJVUzESMBAGA1UE
CgwJVGVzdCBPcmcxHjAcBgNVBAMMFVRlc3QgQ0EgZm9yIEhUVFAgQ1JMFw0yNDEw
MjIwMDAwMDBaFw0yNDEwMjkwMDAwMDBaoA4wDDAKBgNVHRQEAwIBATANBgkqhkiG
9w0BAQsFAAOCAQEAZXhhbXBsZSBzaWduYXR1cmU=
-----END X509 CRL-----`;

    const thisUpdate = new Date();
    const nextUpdate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

    await db.insert(crls).values({
      id: testCrlId,
      caId: testCaId,
      crlNumber: 1,
      thisUpdate,
      nextUpdate,
      crlPem: mockCrlPem,
      revokedCount: 0,
      createdAt: new Date(),
    });

    // Create and configure test server
    server = Fastify({
      logger: false, // Disable logging in tests
    });

    // Register CORS
    await server.register(cors, {
      origin: 'http://localhost:5173',
      credentials: true,
    });

    // Register tRPC
    await server.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: {
        router: appRouter,
        createContext,
      },
    });

    // Add CRL endpoint
    server.get('/crl/:caId.:format', async (req, reply) => {
      const { caId, format } = req.params as { caId: string; format: string };

      // Validate format
      if (format !== 'crl' && format !== 'der') {
        reply.code(400);
        return { error: 'Invalid format. Use .crl for PEM or .der for DER format' };
      }

      try {
        // Check if CA exists
        const ca = await db
          .select()
          .from(certificateAuthorities)
          .where(eq(certificateAuthorities.id, caId))
          .limit(1);

        if (!ca || ca.length === 0) {
          reply.code(404);
          return { error: `CA with ID ${caId} not found` };
        }

        // Get latest CRL for this CA
        const latestCrl = await db
          .select()
          .from(crls)
          .where(eq(crls.caId, caId))
          .orderBy(desc(crls.crlNumber))
          .limit(1);

        if (!latestCrl || latestCrl.length === 0) {
          reply.code(404);
          return { error: `No CRL available for CA ${caId}` };
        }

        const crl = latestCrl[0];

        // Check if CRL PEM exists
        if (!crl.crlPem) {
          reply.code(503);
          return { error: 'CRL not yet signed - signing with KMS-stored keys not yet implemented' };
        }

        // Convert to appropriate format
        let content: Buffer;
        let contentType: string;

        if (format === 'crl') {
          // PEM format
          content = Buffer.from(crl.crlPem, 'utf8');
          contentType = 'application/pkix-crl';
        } else {
          // DER format - convert PEM to DER
          // Remove PEM headers and decode base64
          const base64Data = crl.crlPem
            .replace(/-----BEGIN X509 CRL-----/, '')
            .replace(/-----END X509 CRL-----/, '')
            .replace(/\n/g, '')
            .trim();
          content = Buffer.from(base64Data, 'base64');
          contentType = 'application/pkix-crl';
        }

        // Set headers according to RFC 5280
        reply.header('Content-Type', contentType);
        reply.header('Last-Modified', crl.thisUpdate.toUTCString());
        reply.header('Expires', crl.nextUpdate.toUTCString());

        // Calculate Cache-Control max-age based on time until nextUpdate
        const now = new Date();
        const maxAge = Math.max(0, Math.floor((crl.nextUpdate.getTime() - now.getTime()) / 1000));
        reply.header('Cache-Control', `public, max-age=${maxAge}`);

        return content;
      } catch (error) {
        server.log.error({ error, caId }, 'Failed to serve CRL');
        reply.code(500);
        return { error: 'Internal server error while serving CRL' };
      }
    });

    // Start server on random available port
    await server.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await server.close();
  });

  describe('CRL PEM Format (.crl)', () => {
    it('should serve CRL in PEM format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.crl`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('-----BEGIN X509 CRL-----');
      expect(response.body).toContain('-----END X509 CRL-----');
    });

    it('should set Content-Type header to application/pkix-crl', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.crl`,
      });

      expect(response.headers['content-type']).toBe('application/pkix-crl');
    });

    it('should set Cache-Control header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.crl`,
      });

      expect(response.headers['cache-control']).toBeDefined();
      expect(response.headers['cache-control']).toMatch(/public, max-age=\d+/);
    });

    it('should set Last-Modified header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.crl`,
      });

      expect(response.headers['last-modified']).toBeDefined();
      expect(new Date(response.headers['last-modified'] as string)).toBeInstanceOf(Date);
    });

    it('should set Expires header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.crl`,
      });

      expect(response.headers['expires']).toBeDefined();
      expect(new Date(response.headers['expires'] as string)).toBeInstanceOf(Date);
    });

    it('should not require authentication', async () => {
      // No authorization header needed
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.crl`,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('CRL DER Format (.der)', () => {
    it('should serve CRL in DER format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.der`,
      });

      expect(response.statusCode).toBe(200);
      // DER is binary, should not contain PEM headers
      expect(response.body).not.toContain('-----BEGIN X509 CRL-----');
    });

    it('should set Content-Type header to application/pkix-crl', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.der`,
      });

      expect(response.headers['content-type']).toBe('application/pkix-crl');
    });

    it('should set same headers as PEM format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.der`,
      });

      expect(response.headers['cache-control']).toBeDefined();
      expect(response.headers['last-modified']).toBeDefined();
      expect(response.headers['expires']).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent CA', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/crl/non-existent-ca-id.crl',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('not found');
    });

    it('should return 404 for CA without CRL', async () => {
      // Create a CA without CRL
      const noCrlCaId = randomUUID();
      const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
      };

      const caCert = generateCertificate({
        subject: { CN: 'CA Without CRL', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair.publicKeyPem,
        signingKey: caKeyPair.privateKeyPem,
        selfSigned: true,
      });

      await db.insert(certificateAuthorities).values({
        id: noCrlCaId,
        subjectDn: 'CN=CA Without CRL,O=Test Org,C=US',
        serialNumber: caCert.serialNumber,
        keyAlgorithm: 'RSA-2048',
        notBefore: caCert.validity.notBefore,
        notAfter: caCert.validity.notAfter,
        kmsKeyId: 'test-kms-key-no-crl',
        certificatePem: caCert.pem,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await server.inject({
        method: 'GET',
        url: `/crl/${noCrlCaId}.crl`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('No CRL available');
    });

    it('should return 400 for invalid format', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.txt`,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Invalid format');
    });
  });

  describe('Cache-Control Calculation', () => {
    it('should calculate max-age based on nextUpdate', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/crl/${testCaId}.crl`,
      });

      const cacheControl = response.headers['cache-control'] as string;
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      expect(maxAgeMatch).toBeDefined();

      const maxAge = parseInt(maxAgeMatch![1]);
      // Should be roughly 7 days (604800 seconds)
      // Allow some tolerance for test execution time
      expect(maxAge).toBeGreaterThan(600000); // At least 6.9 days
      expect(maxAge).toBeLessThanOrEqual(604800); // At most 7 days
    });
  });
});
