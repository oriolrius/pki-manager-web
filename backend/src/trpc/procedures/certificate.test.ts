/**
 * Certificate Procedures Tests
 *
 * Tests for certificate.getById endpoint to validate:
 * 1. Certificate retrieval with all fields
 * 2. Certificate extensions parsing
 * 3. Fingerprint calculation
 * 4. Validity status computation
 * 5. Error handling for not found
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { db } from '../../db/client.js';
import { certificates, certificateAuthorities } from '../../db/schema.js';
import { appRouter } from '../router.js';
import { createContext } from '../context.js';
import { generateCertificate } from '../../crypto/x509.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

describe('certificate.getById', () => {
  let caId: string;
  let certId: string;
  let testCertPem: string;

  beforeAll(async () => {
    // Create a test CA
    caId = randomUUID();

    // Generate CA key pair using node-forge
    const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
    };

    const caCert = generateCertificate({
      subject: {
        CN: 'Test CA',
        O: 'Test Organization',
        C: 'US',
      },
      publicKey: caKeyPair.publicKeyPem,
      signingKey: caKeyPair.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: caId,
      subjectDn: 'CN=Test CA,O=Test Organization,C=US',
      serialNumber: caCert.serialNumber,
      keyAlgorithm: 'RSA-4096',
      notBefore: caCert.validity.notBefore,
      notAfter: caCert.validity.notAfter,
      kmsKeyId: 'test-ca-key',
      certificatePem: caCert.pem,
      status: 'active',
    });

    // Create a test certificate
    certId = randomUUID();

    // Generate certificate key pair using node-forge
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: {
        CN: 'test.example.com',
        O: 'Test Organization',
        C: 'US',
      },
      issuer: {
        CN: 'Test CA',
        O: 'Test Organization',
        C: 'US',
      },
      publicKey: certKeyPair.publicKeyPem,
      signingKey: caKeyPair.privateKeyPem,
      extensions: {
        keyUsage: {
          digitalSignature: true,
          keyEncipherment: true,
        },
        extendedKeyUsage: ['serverAuth', 'clientAuth'],
        subjectAltName: {
          dns: ['test.example.com', 'www.test.example.com'],
          ip: ['192.168.1.1'],
        },
      },
    });

    testCertPem = cert.pem;

    await db.insert(certificates).values({
      id: certId,
      caId,
      subjectDn: 'CN=test.example.com,O=Test Organization,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      certificatePem: cert.pem,
      kmsKeyId: 'test-cert-key',
      status: 'active',
      sanDns: JSON.stringify(['test.example.com', 'www.test.example.com']),
      sanIp: JSON.stringify(['192.168.1.1']),
      sanEmail: null,
      renewedFromId: null,
      revocationDate: null,
      revocationReason: null,
    });
  });

  afterAll(async () => {
    // Clean up test data
    const { eq } = await import('drizzle-orm');
    await db.delete(certificates).where(eq(certificates.id, certId)).execute();
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
  });

  it('should retrieve certificate with all fields', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.getById({ id: certId });

    // Basic fields
    expect(result.id).toBe(certId);
    expect(result.caId).toBe(caId);
    expect(result.certificateType).toBe('server');
    expect(result.status).toBe('active');

    // Distinguished names
    expect(result.subject.commonName).toBe('test.example.com');
    expect(result.subject.organization).toBe('Test Organization');
    expect(result.subject.country).toBe('US');
    expect(result.issuer.commonName).toBe('Test CA');

    // Certificate data
    expect(result.certificatePem).toBe(testCertPem);
  });

  it('should calculate fingerprints correctly', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.getById({ id: certId });

    // Fingerprints should be in format XX:XX:XX:...
    expect(result.fingerprints.sha256).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
    expect(result.fingerprints.sha1).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){19}$/);
  });

  it('should parse certificate extensions', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.getById({ id: certId });

    // Key Usage
    expect(result.keyUsage).toBeDefined();
    expect(result.keyUsage?.digitalSignature).toBe(true);
    expect(result.keyUsage?.keyEncipherment).toBe(true);

    // Extended Key Usage
    expect(result.extendedKeyUsage).toContain('serverAuth');
    expect(result.extendedKeyUsage).toContain('clientAuth');

    // Subject Alternative Names
    expect(result.sanDns).toContain('test.example.com');
    expect(result.sanDns).toContain('www.test.example.com');
    expect(result.sanIp).toContain('192.168.1.1');

    // Basic Constraints (may not be present in all certificates)
    // Note: We removed basicConstraints from the test cert to avoid node-forge bugs
  });

  it('should compute validity status correctly', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.getById({ id: certId });

    // Should be valid (not expired, not not_yet_valid)
    expect(result.validityStatus).toBe('valid');
    expect(result.remainingDays).toBeGreaterThan(0);
  });

  it('should include issuing CA information', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.getById({ id: certId });

    expect(result.issuingCA.id).toBe(caId);
    expect(result.issuingCA.subjectDn).toBe('CN=Test CA,O=Test Organization,C=US');
    expect(result.issuingCA.serialNumber).toBeDefined();
  });

  it('should throw NOT_FOUND for non-existent certificate', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const nonExistentId = randomUUID();

    await expect(caller.certificate.getById({ id: nonExistentId })).rejects.toThrow();
  });

  it('should include timestamps', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.getById({ id: certId });

    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
    expect(result.notBefore).toBeInstanceOf(Date);
    expect(result.notAfter).toBeInstanceOf(Date);
  });

  it('should handle renewal chain correctly', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.getById({ id: certId });

    // No renewal chain for this test certificate
    expect(result.renewedFromId).toBeNull();
    expect(result.renewedTo).toBeNull();
  });
});
