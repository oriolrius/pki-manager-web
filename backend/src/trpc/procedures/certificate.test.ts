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

describe('certificate.renew', () => {
  let caId: string;
  let certId: string;
  let caKeyPair: { publicKeyPem: string; privateKeyPem: string };

  beforeAll(async () => {
    // Create a test CA
    caId = randomUUID();

    // Generate CA key pair using node-forge
    const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    caKeyPair = {
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
  });

  afterAll(async () => {
    // Clean up test data
    const { eq } = await import('drizzle-orm');
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
  });

  it('should fail to renew a revoked certificate', async () => {
    // Create a revoked certificate
    const revokedCertId = randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: {
        CN: 'revoked.example.com',
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
    });

    await db.insert(certificates).values({
      id: revokedCertId,
      caId,
      subjectDn: 'CN=revoked.example.com,O=Test Organization,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      certificatePem: cert.pem,
      kmsKeyId: 'test-revoked-cert-key',
      status: 'revoked',
      revocationDate: new Date(),
      revocationReason: 'keyCompromise',
    });

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Should fail to renew revoked certificate
    await expect(
      caller.certificate.renew({
        id: revokedCertId,
        generateNewKey: true,
      })
    ).rejects.toThrow('Cannot renew a revoked certificate');

    // Cleanup
    const { eq } = await import('drizzle-orm');
    await db.delete(certificates).where(eq(certificates.id, revokedCertId)).execute();
  });

  it('should fail to reuse key for certificate older than 90 days', async () => {
    // Create a certificate that's 91 days old
    const oldCertId = randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: {
        CN: 'old.example.com',
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
    });

    // Set createdAt to 91 days ago
    const ninetyOneDaysAgo = new Date();
    ninetyOneDaysAgo.setDate(ninetyOneDaysAgo.getDate() - 91);

    await db.insert(certificates).values({
      id: oldCertId,
      caId,
      subjectDn: 'CN=old.example.com,O=Test Organization,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      certificatePem: cert.pem,
      kmsKeyId: 'test-old-cert-key',
      status: 'active',
      createdAt: ninetyOneDaysAgo,
      updatedAt: ninetyOneDaysAgo,
    });

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Should fail to reuse key
    await expect(
      caller.certificate.renew({
        id: oldCertId,
        generateNewKey: false,
      })
    ).rejects.toThrow('Key reuse is only allowed for certificates less than 90 days old');

    // Cleanup
    const { eq } = await import('drizzle-orm');
    await db.delete(certificates).where(eq(certificates.id, oldCertId)).execute();
  });

  it('should throw NOT_FOUND for non-existent certificate', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const nonExistentId = randomUUID();

    await expect(
      caller.certificate.renew({
        id: nonExistentId,
        generateNewKey: true,
      })
    ).rejects.toThrow('not found');
  });
});

describe('certificate.revoke', () => {
  let caId: string;
  let certId: string;
  let caKeyPair: { publicKeyPem: string; privateKeyPem: string };

  beforeAll(async () => {
    // Create a test CA
    caId = randomUUID();

    // Generate CA key pair using node-forge
    const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    caKeyPair = {
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
  });

  afterAll(async () => {
    // Clean up test data
    const { eq } = await import('drizzle-orm');
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
  });

  it('should revoke a certificate successfully', async () => {
    // Create a test certificate
    certId = randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: {
        CN: 'test-revoke.example.com',
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
    });

    await db.insert(certificates).values({
      id: certId,
      caId,
      subjectDn: 'CN=test-revoke.example.com,O=Test Organization,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      certificatePem: cert.pem,
      kmsKeyId: 'test-cert-key',
      status: 'active',
    });

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Revoke the certificate
    const result = await caller.certificate.revoke({
      id: certId,
      reason: 'keyCompromise',
      details: 'Private key was exposed',
      generateCrl: false,
    });

    expect(result.id).toBe(certId);
    expect(result.status).toBe('revoked');
    expect(result.revocationReason).toContain('keyCompromise');
    expect(result.revocationReason).toContain('Private key was exposed');
    expect(result.revocationDate).toBeDefined();

    // Verify database was updated
    const { eq } = await import('drizzle-orm');
    const dbResult = await db.select().from(certificates).where(eq(certificates.id, certId));
    expect(dbResult[0].status).toBe('revoked');
    expect(dbResult[0].revocationReason).toContain('keyCompromise');

    // Cleanup
    await db.delete(certificates).where(eq(certificates.id, certId)).execute();
  });

  it('should fail to revoke an already revoked certificate', async () => {
    // Create a revoked certificate
    const revokedCertId = randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: {
        CN: 'already-revoked.example.com',
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
    });

    await db.insert(certificates).values({
      id: revokedCertId,
      caId,
      subjectDn: 'CN=already-revoked.example.com,O=Test Organization,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      certificatePem: cert.pem,
      kmsKeyId: 'test-revoked-cert-key',
      status: 'revoked',
      revocationDate: new Date(),
      revocationReason: 'cessationOfOperation',
    });

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Should fail to revoke already revoked certificate
    await expect(
      caller.certificate.revoke({
        id: revokedCertId,
        reason: 'keyCompromise',
      })
    ).rejects.toThrow('Certificate is already revoked');

    // Cleanup
    const { eq } = await import('drizzle-orm');
    await db.delete(certificates).where(eq(certificates.id, revokedCertId)).execute();
  });

  it('should fail with invalid effective date (future)', async () => {
    // Create a test certificate
    const futureCertId = randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: {
        CN: 'future-date.example.com',
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
    });

    await db.insert(certificates).values({
      id: futureCertId,
      caId,
      subjectDn: 'CN=future-date.example.com,O=Test Organization,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      certificatePem: cert.pem,
      kmsKeyId: 'test-future-cert-key',
      status: 'active',
    });

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Try to revoke with future date (timestamp in seconds)
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400; // tomorrow

    await expect(
      caller.certificate.revoke({
        id: futureCertId,
        reason: 'keyCompromise',
        effectiveDate: futureTimestamp,
      })
    ).rejects.toThrow('Effective date cannot be in the future');

    // Cleanup
    const { eq } = await import('drizzle-orm');
    await db.delete(certificates).where(eq(certificates.id, futureCertId)).execute();
  });

  it('should throw NOT_FOUND for non-existent certificate', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const nonExistentId = randomUUID();

    await expect(
      caller.certificate.revoke({
        id: nonExistentId,
        reason: 'keyCompromise',
      })
    ).rejects.toThrow('not found');
  });
});
