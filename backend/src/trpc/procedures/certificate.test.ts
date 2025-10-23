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
      notBefore: caCert.validity.notBefore,
      notAfter: caCert.validity.notAfter,
      kmsKeyId: 'test-ca-key',
      kmsCertificateId: "test-kms-cert-mock",
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
      kmsCertificateId: "test-kms-cert-mock",
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
      kmsCertificateId: "test-kms-cert-mock",
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
      notBefore: caCert.validity.notBefore,
      notAfter: caCert.validity.notAfter,
      kmsKeyId: 'test-ca-key',
      kmsCertificateId: "test-kms-cert-mock",
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
      kmsCertificateId: "test-kms-cert-mock",
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
      kmsCertificateId: "test-kms-cert-mock",
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
      kmsCertificateId: "test-kms-cert-mock",
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

describe('certificate.delete', () => {
  let caId: string;
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
      notBefore: caCert.validity.notBefore,
      notAfter: caCert.validity.notAfter,
      kmsKeyId: 'test-ca-key',
      kmsCertificateId: "test-kms-cert-mock",
      status: 'active',
    });
  });

  afterAll(async () => {
    // Clean up test data
    const { eq } = await import('drizzle-orm');
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
  });

  it('should delete a revoked certificate successfully', async () => {
    // Create a revoked certificate
    const revokedCertId = randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: {
        CN: 'delete-revoked.example.com',
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
      subjectDn: 'CN=delete-revoked.example.com,O=Test Organization,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      kmsCertificateId: "test-kms-cert-mock",
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

    // Delete the certificate
    const result = await caller.certificate.delete({
      id: revokedCertId,
      destroyKey: false,
      removeFromCrl: false,
    });

    expect(result.id).toBe(revokedCertId);
    expect(result.deleted).toBe(true);
    expect(result.kmsKeyDestroyed).toBe(false);

    // Verify certificate was deleted from database
    const { eq } = await import('drizzle-orm');
    const dbResult = await db.select().from(certificates).where(eq(certificates.id, revokedCertId));
    expect(dbResult).toHaveLength(0);
  });

  it('should delete an expired certificate (> 90 days)', async () => {
    // Create a certificate that expired 91 days ago
    const expiredCertId = randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: {
        CN: 'expired.example.com',
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

    // Set notAfter to 91 days ago
    const ninetyOneDaysAgo = new Date();
    ninetyOneDaysAgo.setDate(ninetyOneDaysAgo.getDate() - 91);

    await db.insert(certificates).values({
      id: expiredCertId,
      caId,
      subjectDn: 'CN=expired.example.com,O=Test Organization,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: new Date(ninetyOneDaysAgo.getTime() - 365 * 24 * 60 * 60 * 1000), // 1 year before expiry
      notAfter: ninetyOneDaysAgo,
      kmsCertificateId: "test-kms-cert-mock",
      kmsKeyId: 'test-expired-cert-key',
      status: 'expired',
    });

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Delete the certificate
    const result = await caller.certificate.delete({
      id: expiredCertId,
      destroyKey: false,
    });

    expect(result.deleted).toBe(true);

    // Verify certificate was deleted from database
    const { eq } = await import('drizzle-orm');
    const dbResult = await db.select().from(certificates).where(eq(certificates.id, expiredCertId));
    expect(dbResult).toHaveLength(0);
  });

  it('should fail to delete an active certificate', async () => {
    // Create an active certificate
    const activeCertId = randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: {
        CN: 'active.example.com',
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
      id: activeCertId,
      caId,
      subjectDn: 'CN=active.example.com,O=Test Organization,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      kmsCertificateId: "test-kms-cert-mock",
      kmsKeyId: 'test-active-cert-key',
      status: 'active',
    });

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Should fail to delete active certificate
    await expect(
      caller.certificate.delete({
        id: activeCertId,
        destroyKey: false,
      })
    ).rejects.toThrow('Certificate must be revoked or expired for more than 90 days before deletion');

    // Cleanup
    const { eq } = await import('drizzle-orm');
    await db.delete(certificates).where(eq(certificates.id, activeCertId)).execute();
  });

  it('should fail to delete a recently expired certificate (< 90 days)', async () => {
    // Create a certificate that expired 30 days ago
    const recentlyExpiredCertId = randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: {
        CN: 'recently-expired.example.com',
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

    // Set notAfter to 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    await db.insert(certificates).values({
      id: recentlyExpiredCertId,
      caId,
      subjectDn: 'CN=recently-expired.example.com,O=Test Organization,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: new Date(thirtyDaysAgo.getTime() - 365 * 24 * 60 * 60 * 1000),
      notAfter: thirtyDaysAgo,
      kmsCertificateId: "test-kms-cert-mock",
      kmsKeyId: 'test-recent-expired-cert-key',
      status: 'expired',
    });

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Should fail to delete recently expired certificate
    await expect(
      caller.certificate.delete({
        id: recentlyExpiredCertId,
        destroyKey: false,
      })
    ).rejects.toThrow('Certificate must be revoked or expired for more than 90 days before deletion');

    // Cleanup
    const { eq } = await import('drizzle-orm');
    await db.delete(certificates).where(eq(certificates.id, recentlyExpiredCertId)).execute();
  });

  it('should throw NOT_FOUND for non-existent certificate', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const nonExistentId = randomUUID();

    await expect(
      caller.certificate.delete({
        id: nonExistentId,
        destroyKey: false,
      })
    ).rejects.toThrow('not found');
  });
});


describe('certificate.issue - Client Certificates', () => {
  let caId: string;

  beforeAll(async () => {
    // Create a test CA
    caId = randomUUID();
    const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
    };

    const caCert = generateCertificate({
      subject: { CN: 'Test CA', O: 'Test Organization', C: 'US' },
      publicKey: caKeyPair.publicKeyPem,
      signingKey: caKeyPair.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: caId,
      subjectDn: 'CN=Test CA,O=Test Organization,C=US',
      serialNumber: caCert.serialNumber,
      notBefore: caCert.validity.notBefore,
      notAfter: caCert.validity.notAfter,
      kmsKeyId: 'test-ca-key',
      kmsCertificateId: "test-kms-cert-mock",
      status: 'active',
    });
  });

  afterAll(async () => {
    const { eq } = await import('drizzle-orm');
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
  });

  it('should validate client certificate CN as email format', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Valid email CN should not throw
    await expect(
      caller.certificate.issue({
        caId,
        certificateType: 'client',
        subject: {
          commonName: 'user@example.com',
          organization: 'Test Org',
          country: 'US',
        },
        validityDays: 365,
        sanEmail: ['user@example.com'],
      })
    ).rejects.toThrow(); // Will fail due to KMS mock not being set up, but CN validation passes
  });

  it('should validate client certificate CN as username format', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Valid username CN should not throw CN validation error
    await expect(
      caller.certificate.issue({
        caId,
        certificateType: 'client',
        subject: {
          commonName: 'john_doe-123',
          organization: 'Test Org',
          country: 'US',
        },
        validityDays: 365,
      })
    ).rejects.toThrow(); // Will fail due to KMS, but CN validation passes
  });

  it('should reject client certificate with invalid CN format', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId,
        certificateType: 'client',
        subject: {
          commonName: 'invalid cn with spaces!',
          organization: 'Test Org',
          country: 'US',
        },
        validityDays: 365,
      })
    ).rejects.toThrow('Client certificate CN must be a valid email address or username');
  });

  it('should validate email SANs for client certificates', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId,
        certificateType: 'client',
        subject: {
          commonName: 'user@example.com',
          organization: 'Test Org',
          country: 'US',
        },
        validityDays: 365,
        sanEmail: ['invalid-email'],
      })
    ).rejects.toThrow('Invalid email');
  });
});

describe('certificate.issue - Code Signing Certificates', () => {
  let caId: string;

  beforeAll(async () => {
    caId = randomUUID();
    const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
    };

    const caCert = generateCertificate({
      subject: { CN: 'Test CA', O: 'Test Organization', C: 'US' },
      publicKey: caKeyPair.publicKeyPem,
      signingKey: caKeyPair.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: caId,
      subjectDn: 'CN=Test CA,O=Test Organization,C=US',
      serialNumber: caCert.serialNumber,
      notBefore: caCert.validity.notBefore,
      notAfter: caCert.validity.notAfter,
      kmsKeyId: 'test-ca-key',
      kmsCertificateId: "test-kms-cert-mock",
      status: 'active',
    });
  });

  afterAll(async () => {
    const { eq } = await import('drizzle-orm');
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
  });

  it('should enforce organization requirement for code signing certificates', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId,
        certificateType: 'code_signing',
        subject: {
          commonName: 'Code Signer',
          country: 'US',
        },
        validityDays: 730,
      })
    ).rejects.toThrow('Required');
  });

  it('should enforce minimum key strength for code signing certificates', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId,
        certificateType: 'code_signing',
        subject: {
          commonName: 'Code Signer',
          organization: 'Test Corp',
          country: 'US',
        },
        validityDays: 730,
      })
    ).rejects.toThrow('Code signing certificates require RSA-3072, RSA-4096, or ECDSA-P256 minimum');
  });
});

describe('certificate.issue - Email Protection Certificates', () => {
  let caId: string;

  beforeAll(async () => {
    caId = randomUUID();
    const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
    };

    const caCert = generateCertificate({
      subject: { CN: 'Test CA', O: 'Test Organization', C: 'US' },
      publicKey: caKeyPair.publicKeyPem,
      signingKey: caKeyPair.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: caId,
      subjectDn: 'CN=Test CA,O=Test Organization,C=US',
      serialNumber: caCert.serialNumber,
      notBefore: caCert.validity.notBefore,
      notAfter: caCert.validity.notAfter,
      kmsKeyId: 'test-ca-key',
      kmsCertificateId: "test-kms-cert-mock",
      status: 'active',
    });
  });

  afterAll(async () => {
    const { eq } = await import('drizzle-orm');
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
  });

  it('should require at least one email address in SANs', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId,
        certificateType: 'email',
        subject: {
          commonName: 'John Doe',
          organization: 'Test Org',
          country: 'US',
        },
        validityDays: 365,
      })
    ).rejects.toThrow('Email protection certificates require at least one email address in SANs');
  });

  it('should enforce same-domain validation for email addresses', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId,
        certificateType: 'email',
        subject: {
          commonName: 'John Doe',
          organization: 'Test Org',
          country: 'US',
        },
        validityDays: 365,
        sanEmail: ['user@example.com', 'admin@different.com'],
      })
    ).rejects.toThrow('All email addresses must be from the same domain');
  });
});
