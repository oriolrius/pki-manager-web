/**
 * Certificate Authority (CA) Procedures Tests
 *
 * Tests for CA endpoints to validate:
 * 1. CA listing with filters, search, and pagination
 * 2. CA detail retrieval with certificate counts
 * 3. CA revocation with validation
 * 4. CA deletion with safety checks
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import forge from 'node-forge';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates, crls, auditLog } from '../../db/schema.js';
import { appRouter } from '../router.js';
import { createContext } from '../context.js';
import { generateCertificate } from '../../crypto/x509.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

describe('ca.list', () => {
  let ca1Id: string;
  let ca2Id: string;
  let ca3Id: string;

  beforeAll(async () => {
    // Create test CAs with different attributes
    ca1Id = randomUUID();
    ca2Id = randomUUID();
    ca3Id = randomUUID();

    const caKeypair1 = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair1 = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair1.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair1.privateKey),
    };

    const caCert1 = generateCertificate({
      subject: { CN: 'Alpha CA', O: 'Test Org', C: 'US' },
      publicKey: caKeyPair1.publicKeyPem,
      signingKey: caKeyPair1.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: ca1Id,
      subjectDn: 'CN=Alpha CA,O=Test Org,C=US',
      serialNumber: caCert1.serialNumber,
      notBefore: caCert1.validity.notBefore,
      notAfter: caCert1.validity.notAfter,
      kmsKeyId: 'test-ca-key-1',
      kmsCertificateId: 'test-kms-cert-1',
      status: 'active',
    });

    // Second CA with different algorithm
    const caKeypair2 = forge.pki.rsa.generateKeyPair({ bits: 4096 });
    const caKeyPair2 = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair2.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair2.privateKey),
    };

    const caCert2 = generateCertificate({
      subject: { CN: 'Beta CA', O: 'Another Org', C: 'US' },
      publicKey: caKeyPair2.publicKeyPem,
      signingKey: caKeyPair2.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: ca2Id,
      subjectDn: 'CN=Beta CA,O=Another Org,C=US',
      serialNumber: caCert2.serialNumber,
      notBefore: caCert2.validity.notBefore,
      notAfter: caCert2.validity.notAfter,
      kmsKeyId: 'test-ca-key-2',
      kmsCertificateId: 'test-kms-cert-2',
      status: 'active',
    });

    // Third CA - revoked
    const caKeypair3 = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair3 = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair3.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair3.privateKey),
    };

    const caCert3 = generateCertificate({
      subject: { CN: 'Gamma CA', O: 'Test Org', C: 'US' },
      publicKey: caKeyPair3.publicKeyPem,
      signingKey: caKeyPair3.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: ca3Id,
      subjectDn: 'CN=Gamma CA,O=Test Org,C=US',
      serialNumber: caCert3.serialNumber,
      notBefore: caCert3.validity.notBefore,
      notAfter: caCert3.validity.notAfter,
      kmsKeyId: 'test-ca-key-3',
      kmsCertificateId: 'test-kms-cert-3',
      status: 'revoked',
      revocationDate: new Date(),
      revocationReason: 'keyCompromise',
    });

    // Add a certificate to ca1 for count testing
    const certId = randomUUID();
    const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const certKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(certKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(certKeypair.privateKey),
    };

    const cert = generateCertificate({
      subject: { CN: 'test.example.com', O: 'Test Org', C: 'US' },
      issuer: { CN: 'Alpha CA', O: 'Test Org', C: 'US' },
      publicKey: certKeyPair.publicKeyPem,
      signingKey: caKeyPair1.privateKeyPem,
    });

    await db.insert(certificates).values({
      id: certId,
      caId: ca1Id,
      subjectDn: 'CN=test.example.com,O=Test Org,C=US',
      serialNumber: cert.serialNumber,
      certificateType: 'server',
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      kmsKeyId: 'test-cert-key',
      kmsCertificateId: 'test-kms-cert-child-1',
      status: 'active',
    });
  });

  afterAll(async () => {
    await db.delete(certificates).where(eq(certificates.caId, ca1Id)).execute();
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, ca1Id)).execute();
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, ca2Id)).execute();
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, ca3Id)).execute();
  });

  it('should list all CAs without filters', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.ca.list();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('should filter CAs by status (active)', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.ca.list({
      status: 'active',
    });

    expect(result.every(ca => ca.status === 'active')).toBe(true);
    expect(result.some(ca => ca.id === ca1Id || ca.id === ca2Id)).toBe(true);
  });

  it('should filter CAs by status (revoked)', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.ca.list({
      status: 'revoked',
    });

    expect(result.every(ca => ca.status === 'revoked')).toBe(true);
    const revokedCA = result.find(ca => ca.id === ca3Id);
    expect(revokedCA).toBeDefined();
  });

  it('should search CAs by name', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.ca.list({
      search: 'Beta',
    });

    expect(result.some(ca => ca.subject.includes('Beta CA'))).toBe(true);
  });

  it('should include certificate count for each CA', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.ca.list();

    const ca1 = result.find(ca => ca.id === ca1Id);
    expect(ca1).toBeDefined();
    expect(ca1!.certificateCount).toBe(1);
  });

  it('should support pagination', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.ca.list({
      limit: 1,
      offset: 0,
    });

    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});


describe('ca.revoke', () => {
  let caId: string;

  beforeAll(async () => {
    caId = randomUUID();
    const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
    };

    const caCert = generateCertificate({
      subject: { CN: 'Revoke Test CA', O: 'Test Org', C: 'US' },
      publicKey: caKeyPair.publicKeyPem,
      signingKey: caKeyPair.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: caId,
      subjectDn: 'CN=Revoke Test CA,O=Test Org,C=US',
      serialNumber: caCert.serialNumber,
      notBefore: caCert.validity.notBefore,
      notAfter: caCert.validity.notAfter,
      kmsKeyId: 'test-ca-key',
      kmsCertificateId: 'test-kms-cert-5',
      status: 'active',
    });
  });

  afterAll(async () => {
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
  });

  it('should revoke a CA successfully', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.ca.revoke({
      id: caId,
      reason: 'keyCompromise',
      details: 'Test revocation',
    });

    expect(result.caId).toBe(caId);
    expect(result.success).toBe(true);
    expect(result.reason).toContain('keyCompromise');
    expect(result.revocationDate).toBeDefined();
    expect(result.crlGenerated).toBe(true);
  });

  it('should fail to revoke already revoked CA', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.ca.revoke({
        id: caId,
        reason: 'keyCompromise',
      })
    ).rejects.toThrow('already revoked');
  });
});

describe('ca.delete', () => {
  let revokedCaId: string;
  let activeCaId: string;

  beforeAll(async () => {
    // Create a revoked CA
    revokedCaId = randomUUID();
    const caKeypair1 = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair1 = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair1.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair1.privateKey),
    };

    const caCert1 = generateCertificate({
      subject: { CN: 'Delete Test CA', O: 'Test Org', C: 'US' },
      publicKey: caKeyPair1.publicKeyPem,
      signingKey: caKeyPair1.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: revokedCaId,
      subjectDn: 'CN=Delete Test CA,O=Test Org,C=US',
      serialNumber: caCert1.serialNumber,
      notBefore: caCert1.validity.notBefore,
      notAfter: caCert1.validity.notAfter,
      kmsKeyId: 'test-ca-key-1',
      kmsCertificateId: 'test-kms-cert-6',
      status: 'revoked',
      revocationDate: new Date(),
      revocationReason: 'keyCompromise',
    });

    // Create an active CA
    activeCaId = randomUUID();
    const caKeypair2 = forge.pki.rsa.generateKeyPair({ bits: 2048 });
    const caKeyPair2 = {
      publicKeyPem: forge.pki.publicKeyToPem(caKeypair2.publicKey),
      privateKeyPem: forge.pki.privateKeyToPem(caKeypair2.privateKey),
    };

    const caCert2 = generateCertificate({
      subject: { CN: 'Active CA', O: 'Test Org', C: 'US' },
      publicKey: caKeyPair2.publicKeyPem,
      signingKey: caKeyPair2.privateKeyPem,
      selfSigned: true,
    });

    await db.insert(certificateAuthorities).values({
      id: activeCaId,
      subjectDn: 'CN=Active CA,O=Test Org,C=US',
      serialNumber: caCert2.serialNumber,
      notBefore: caCert2.validity.notBefore,
      notAfter: caCert2.validity.notAfter,
      kmsKeyId: 'test-ca-key-2',
      kmsCertificateId: 'test-kms-cert-7',
      status: 'active',
    });
  });

  afterAll(async () => {
    await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, activeCaId)).execute();
  });

  it('should delete a revoked CA successfully', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.ca.delete({
      id: revokedCaId,
      destroyKey: false,
    });

    expect(result.caId).toBe(revokedCaId);
    expect(result.success).toBe(true);

    // Verify it was deleted
    const dbResult = await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, revokedCaId));
    expect(dbResult).toHaveLength(0);
  });

  it('should fail to delete an active CA', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.ca.delete({
        id: activeCaId,
        destroyKey: false,
      })
    ).rejects.toThrow('CA must be revoked or expired before deletion');
  });

  it('should throw NOT_FOUND for non-existent CA', async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const nonExistentId = randomUUID();

    await expect(
      caller.ca.delete({
        id: nonExistentId,
        destroyKey: false,
      })
    ).rejects.toThrow('not found');
  });
});


describe('ca.revoke - comprehensive tests', () => {
  describe('cascade revocation', () => {
    let caId: string;
    let cert1Id: string;
    let cert2Id: string;
    let cert3Id: string;

    beforeAll(async () => {
      caId = randomUUID();
      cert1Id = randomUUID();
      cert2Id = randomUUID();
      cert3Id = randomUUID();

      const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
      };

      const caCert = generateCertificate({
        subject: { CN: 'Cascade Test CA', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair.publicKeyPem,
        signingKey: caKeyPair.privateKeyPem,
        selfSigned: true,
      });

      await db.insert(certificateAuthorities).values({
        id: caId,
        subjectDn: 'CN=Cascade Test CA,O=Test Org,C=US',
        serialNumber: caCert.serialNumber,
        notBefore: caCert.validity.notBefore,
        notAfter: caCert.validity.notAfter,
        kmsKeyId: 'test-cascade-ca-key',
        kmsCertificateId: 'test-cascade-kms-cert',
        status: 'active',
      });

      // Create 2 active certificates and 1 revoked certificate
      const certKeypair1 = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const cert1 = generateCertificate({
        subject: { CN: 'cert1.example.com', O: 'Test Org', C: 'US' },
        issuer: { CN: 'Cascade Test CA', O: 'Test Org', C: 'US' },
        publicKey: forge.pki.publicKeyToPem(certKeypair1.publicKey),
        signingKey: caKeyPair.privateKeyPem,
      });

      await db.insert(certificates).values({
        id: cert1Id,
        caId: caId,
        subjectDn: 'CN=cert1.example.com,O=Test Org,C=US',
        serialNumber: cert1.serialNumber,
        certificateType: 'server',
        notBefore: cert1.validity.notBefore,
        notAfter: cert1.validity.notAfter,
        kmsKeyId: 'test-cert-key-1',
        kmsCertificateId: 'test-kms-cert-cascade-1',
        status: 'active',
      });

      const certKeypair2 = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const cert2 = generateCertificate({
        subject: { CN: 'cert2.example.com', O: 'Test Org', C: 'US' },
        issuer: { CN: 'Cascade Test CA', O: 'Test Org', C: 'US' },
        publicKey: forge.pki.publicKeyToPem(certKeypair2.publicKey),
        signingKey: caKeyPair.privateKeyPem,
      });

      await db.insert(certificates).values({
        id: cert2Id,
        caId: caId,
        subjectDn: 'CN=cert2.example.com,O=Test Org,C=US',
        serialNumber: cert2.serialNumber,
        certificateType: 'server',
        notBefore: cert2.validity.notBefore,
        notAfter: cert2.validity.notAfter,
        kmsKeyId: 'test-cert-key-2',
        kmsCertificateId: 'test-kms-cert-cascade-2',
        status: 'active',
      });

      // Already revoked certificate
      const certKeypair3 = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const cert3 = generateCertificate({
        subject: { CN: 'cert3.example.com', O: 'Test Org', C: 'US' },
        issuer: { CN: 'Cascade Test CA', O: 'Test Org', C: 'US' },
        publicKey: forge.pki.publicKeyToPem(certKeypair3.publicKey),
        signingKey: caKeyPair.privateKeyPem,
      });

      await db.insert(certificates).values({
        id: cert3Id,
        caId: caId,
        subjectDn: 'CN=cert3.example.com,O=Test Org,C=US',
        serialNumber: cert3.serialNumber,
        certificateType: 'server',
        notBefore: cert3.validity.notBefore,
        notAfter: cert3.validity.notAfter,
        kmsKeyId: 'test-cert-key-3',
        kmsCertificateId: 'test-kms-cert-cascade-3',
        status: 'revoked',
        revocationDate: new Date(),
        revocationReason: 'keyCompromise',
      });
    });

    afterAll(async () => {
      await db.delete(certificates).where(eq(certificates.caId, caId)).execute();
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
    });

    it('should revoke CA and cascade to all active child certificates', async () => {
      const context = await createContext({
        req: {} as FastifyRequest,
        res: {} as FastifyReply,
      });
      const caller = appRouter.createCaller(context);

      const result = await caller.ca.revoke({
        id: caId,
        reason: 'keyCompromise',
        details: 'Test cascade revocation',
      });

      expect(result.success).toBe(true);
      expect(result.cascadeRevokedCount).toBe(2); // Only 2 active certs

      // Verify CA is revoked
      const caResult = await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, caId));
      expect(caResult[0].status).toBe('revoked');
      expect(caResult[0].revocationReason).toBe('keyCompromise');

      // Verify active certificates are now revoked with caCompromise reason
      const cert1Result = await db.select().from(certificates).where(eq(certificates.id, cert1Id));
      expect(cert1Result[0].status).toBe('revoked');
      expect(cert1Result[0].revocationReason).toBe('caCompromise');
      expect(cert1Result[0].revocationDate).toBeDefined();

      const cert2Result = await db.select().from(certificates).where(eq(certificates.id, cert2Id));
      expect(cert2Result[0].status).toBe('revoked');
      expect(cert2Result[0].revocationReason).toBe('caCompromise');

      // Verify already revoked certificate is unchanged
      const cert3Result = await db.select().from(certificates).where(eq(certificates.id, cert3Id));
      expect(cert3Result[0].revocationReason).toBe('keyCompromise'); // Original reason preserved
    });
  });

  describe('CRL generation', () => {
    let caId: string;

    beforeAll(async () => {
      caId = randomUUID();
      const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
      };

      const caCert = generateCertificate({
        subject: { CN: 'CRL Test CA', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair.publicKeyPem,
        signingKey: caKeyPair.privateKeyPem,
        selfSigned: true,
      });

      await db.insert(certificateAuthorities).values({
        id: caId,
        subjectDn: 'CN=CRL Test CA,O=Test Org,C=US',
        serialNumber: caCert.serialNumber,
        notBefore: caCert.validity.notBefore,
        notAfter: caCert.validity.notAfter,
        kmsKeyId: 'test-crl-ca-key',
        kmsCertificateId: 'test-crl-kms-cert',
        status: 'active',
      });
    });

    afterAll(async () => {
      await db.delete(crls).where(eq(crls.caId, caId)).execute();
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
    });

    it('should generate CRL record with correct number and dates', async () => {
      const context = await createContext({
        req: {} as FastifyRequest,
        res: {} as FastifyReply,
      });
      const caller = appRouter.createCaller(context);

      const result = await caller.ca.revoke({
        id: caId,
        reason: 'unspecified',
      });

      expect(result.crlGenerated).toBe(true);
      expect(result.crlId).toBeDefined();

      // Verify CRL record in database
      const crlResult = await db.select().from(crls).where(eq(crls.id, result.crlId));
      expect(crlResult).toHaveLength(1);

      const crl = crlResult[0];
      expect(crl.caId).toBe(caId);
      expect(crl.crlNumber).toBeGreaterThanOrEqual(0);
      expect(crl.thisUpdate).toBeDefined();
      expect(crl.nextUpdate).toBeDefined();

      // nextUpdate should be ~7 days from thisUpdate
      const daysDiff = (crl.nextUpdate.getTime() - crl.thisUpdate.getTime()) / (1000 * 60 * 60 * 24);
      expect(daysDiff).toBeGreaterThan(6);
      expect(daysDiff).toBeLessThan(8);
    });
  });

  describe('revocation reasons', () => {
    let testCAs: string[] = [];

    beforeAll(async () => {
      const reasons = [
        'unspecified',
        'keyCompromise',
        'caCompromise',
        'affiliationChanged',
        'superseded',
        'cessationOfOperation',
        'certificateHold',
        'privilegeWithdrawn',
      ];

      for (const reason of reasons) {
        const caId = randomUUID();
        testCAs.push(caId);

        const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
        const caKeyPair = {
          publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
          privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
        };

        const caCert = generateCertificate({
          subject: { CN: `Reason ${reason} CA`, O: 'Test Org', C: 'US' },
          publicKey: caKeyPair.publicKeyPem,
          signingKey: caKeyPair.privateKeyPem,
          selfSigned: true,
        });

        await db.insert(certificateAuthorities).values({
          id: caId,
          subjectDn: `CN=Reason ${reason} CA,O=Test Org,C=US`,
          serialNumber: caCert.serialNumber,
          notBefore: caCert.validity.notBefore,
          notAfter: caCert.validity.notAfter,
          kmsKeyId: `test-reason-${reason}-key`,
          kmsCertificateId: `test-kms-reason-${reason}`,
          status: 'active',
        });
      }
    });

    afterAll(async () => {
      for (const caId of testCAs) {
        await db.delete(crls).where(eq(crls.caId, caId)).execute();
        await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
      }
    });

    it('should preserve all revocation reasons correctly', async () => {
      const context = await createContext({
        req: {} as FastifyRequest,
        res: {} as FastifyReply,
      });
      const caller = appRouter.createCaller(context);

      const reasons = [
        'unspecified',
        'keyCompromise',
        'caCompromise',
        'affiliationChanged',
        'superseded',
        'cessationOfOperation',
        'certificateHold',
        'privilegeWithdrawn',
      ];

      for (let i = 0; i < reasons.length; i++) {
        const reason = reasons[i] as any;
        const caId = testCAs[i];

        const result = await caller.ca.revoke({
          id: caId,
          reason: reason,
          details: `Testing ${reason}`,
        });

        expect(result.success).toBe(true);
        expect(result.reason).toContain(reason);

        // Verify in database
        const caResult = await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, caId));
        expect(caResult[0].revocationReason).toBe(reason);
      }
    });
  });

  describe('audit logging', () => {
    let caId: string;

    beforeAll(async () => {
      caId = randomUUID();
      const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
      };

      const caCert = generateCertificate({
        subject: { CN: 'Audit Test CA', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair.publicKeyPem,
        signingKey: caKeyPair.privateKeyPem,
        selfSigned: true,
      });

      await db.insert(certificateAuthorities).values({
        id: caId,
        subjectDn: 'CN=Audit Test CA,O=Test Org,C=US',
        serialNumber: caCert.serialNumber,
        notBefore: caCert.validity.notBefore,
        notAfter: caCert.validity.notAfter,
        kmsKeyId: 'test-audit-ca-key',
        kmsCertificateId: 'test-audit-kms-cert',
        status: 'active',
      });
    });

    afterAll(async () => {
      await db.delete(crls).where(eq(crls.caId, caId)).execute();
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
      await db.delete(auditLog).where(and(eq(auditLog.entityType, 'ca'), eq(auditLog.entityId, caId))).execute();
    });

    it('should create proper audit log entry on revocation', async () => {
      const context = await createContext({
        req: {} as FastifyRequest,
        res: {} as FastifyReply,
      });
      const caller = appRouter.createCaller(context);

      await caller.ca.revoke({
        id: caId,
        reason: 'keyCompromise',
        details: 'Audit test',
      });

      // Check audit log
      const auditResult = await db.select().from(auditLog)
        .where(and(eq(auditLog.entityType, 'ca'), eq(auditLog.entityId, caId), eq(auditLog.operation, 'ca.revoke')));

      expect(auditResult.length).toBeGreaterThan(0);
      const audit = auditResult[0];
      expect(audit.status).toBe('success');
      expect(audit.details).toBeDefined();

      const details = JSON.parse(audit.details!);
      expect(details.reason).toBe('keyCompromise');
      expect(details.cascadeRevoked).toBeDefined();
      expect(details.crlGenerated).toBe(true);
    });
  });

  describe('edge cases', () => {
    let emptyCaId: string;

    beforeAll(async () => {
      // CA with no certificates
      emptyCaId = randomUUID();
      const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
      };

      const caCert = generateCertificate({
        subject: { CN: 'Empty CA', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair.publicKeyPem,
        signingKey: caKeyPair.privateKeyPem,
        selfSigned: true,
      });

      await db.insert(certificateAuthorities).values({
        id: emptyCaId,
        subjectDn: 'CN=Empty CA,O=Test Org,C=US',
        serialNumber: caCert.serialNumber,
        notBefore: caCert.validity.notBefore,
        notAfter: caCert.validity.notAfter,
        kmsKeyId: 'test-empty-ca-key',
        kmsCertificateId: 'test-empty-kms-cert',
        status: 'active',
      });
    });

    afterAll(async () => {
      await db.delete(crls).where(eq(crls.caId, emptyCaId)).execute();
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, emptyCaId)).execute();
    });

    it('should revoke CA with no certificates successfully', async () => {
      const context = await createContext({
        req: {} as FastifyRequest,
        res: {} as FastifyReply,
      });
      const caller = appRouter.createCaller(context);

      const result = await caller.ca.revoke({
        id: emptyCaId,
        reason: 'unspecified',
      });

      expect(result.success).toBe(true);
      expect(result.cascadeRevokedCount).toBe(0);
      expect(result.crlGenerated).toBe(true);
    });
  });
});


describe('ca.delete - comprehensive tests', () => {
  describe('expired CA deletion', () => {
    let expiredCaId: string;

    beforeAll(async () => {
      expiredCaId = randomUUID();
      const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
      };

      const caCert = generateCertificate({
        subject: { CN: 'Expired CA', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair.publicKeyPem,
        signingKey: caKeyPair.privateKeyPem,
        selfSigned: true,
      });

      // Create CA with notAfter in the past
      await db.insert(certificateAuthorities).values({
        id: expiredCaId,
        subjectDn: 'CN=Expired CA,O=Test Org,C=US',
        serialNumber: caCert.serialNumber,
        notBefore: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
        notAfter: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago (expired)
        kmsKeyId: 'test-expired-ca-key',
        kmsCertificateId: 'test-expired-kms-cert',
        status: 'active', // Still active, but expired
      });
    });

    afterAll(async () => {
      // Cleanup may not be needed if delete succeeds
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, expiredCaId)).execute().catch(() => {});
    });

    it('should allow deletion of expired CA even if status is active', async () => {
      const context = await createContext({
        req: {} as FastifyRequest,
        res: {} as FastifyReply,
      });
      const caller = appRouter.createCaller(context);

      const result = await caller.ca.delete({
        id: expiredCaId,
        destroyKey: false,
      });

      expect(result.success).toBe(true);

      // Verify deletion
      const caResult = await db.select().from(certificateAuthorities).where(eq(certificateAuthorities.id, expiredCaId));
      expect(caResult).toHaveLength(0);
    });
  });

  describe('CA with active certificates', () => {
    let caId: string;
    let certId: string;

    beforeAll(async () => {
      caId = randomUUID();
      certId = randomUUID();

      const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
      };

      const caCert = generateCertificate({
        subject: { CN: 'Active Certs CA', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair.publicKeyPem,
        signingKey: caKeyPair.privateKeyPem,
        selfSigned: true,
      });

      await db.insert(certificateAuthorities).values({
        id: caId,
        subjectDn: 'CN=Active Certs CA,O=Test Org,C=US',
        serialNumber: caCert.serialNumber,
        notBefore: caCert.validity.notBefore,
        notAfter: caCert.validity.notAfter,
        kmsKeyId: 'test-active-certs-ca-key',
        kmsCertificateId: 'test-active-certs-kms-cert',
        status: 'revoked',
        revocationDate: new Date(),
        revocationReason: 'keyCompromise',
      });

      // Add active certificate
      const certKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const cert = generateCertificate({
        subject: { CN: 'active.example.com', O: 'Test Org', C: 'US' },
        issuer: { CN: 'Active Certs CA', O: 'Test Org', C: 'US' },
        publicKey: forge.pki.publicKeyToPem(certKeypair.publicKey),
        signingKey: caKeyPair.privateKeyPem,
      });

      await db.insert(certificates).values({
        id: certId,
        caId: caId,
        subjectDn: 'CN=active.example.com,O=Test Org,C=US',
        serialNumber: cert.serialNumber,
        certificateType: 'server',
        notBefore: cert.validity.notBefore,
        notAfter: cert.validity.notAfter,
        kmsKeyId: 'test-active-cert-key',
        kmsCertificateId: 'test-active-cert-kms',
        status: 'active',
      });
    });

    afterAll(async () => {
      await db.delete(certificates).where(eq(certificates.id, certId)).execute();
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute();
    });

    it('should prevent deletion when CA has active certificates', async () => {
      const context = await createContext({
        req: {} as FastifyRequest,
        res: {} as FastifyReply,
      });
      const caller = appRouter.createCaller(context);

      await expect(
        caller.ca.delete({
          id: caId,
          destroyKey: false,
        })
      ).rejects.toThrow('Cannot delete CA with 1 active certificate');
    });
  });

  describe('CRL cleanup', () => {
    let caId: string;
    let crl1Id: string;
    let crl2Id: string;

    beforeAll(async () => {
      caId = randomUUID();
      crl1Id = randomUUID();
      crl2Id = randomUUID();

      const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
      };

      const caCert = generateCertificate({
        subject: { CN: 'CRL Cleanup CA', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair.publicKeyPem,
        signingKey: caKeyPair.privateKeyPem,
        selfSigned: true,
      });

      await db.insert(certificateAuthorities).values({
        id: caId,
        subjectDn: 'CN=CRL Cleanup CA,O=Test Org,C=US',
        serialNumber: caCert.serialNumber,
        notBefore: caCert.validity.notBefore,
        notAfter: caCert.validity.notAfter,
        kmsKeyId: 'test-crl-cleanup-ca-key',
        kmsCertificateId: 'test-crl-cleanup-kms-cert',
        status: 'revoked',
        revocationDate: new Date(),
        revocationReason: 'superseded',
      });

      // Create 2 CRL records
      await db.insert(crls).values({
        id: crl1Id,
        caId: caId,
        crlNumber: 1,
        thisUpdate: new Date(),
        nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        crlPem: '',
        revokedCount: 0,
      });

      await db.insert(crls).values({
        id: crl2Id,
        caId: caId,
        crlNumber: 2,
        thisUpdate: new Date(),
        nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        crlPem: '',
        revokedCount: 0,
      });
    });

    afterAll(async () => {
      // Cleanup may not be needed if delete succeeds
      await db.delete(crls).where(eq(crls.caId, caId)).execute().catch(() => {});
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute().catch(() => {});
    });

    it('should delete all orphaned CRL records', async () => {
      const context = await createContext({
        req: {} as FastifyRequest,
        res: {} as FastifyReply,
      });
      const caller = appRouter.createCaller(context);

      const result = await caller.ca.delete({
        id: caId,
        destroyKey: false,
      });

      expect(result.success).toBe(true);
      expect(result.crlsDeleted).toBe(2);

      // Verify CRLs are deleted
      const crlResult = await db.select().from(crls).where(eq(crls.caId, caId));
      expect(crlResult).toHaveLength(0);
    });
  });

  describe('audit logging on deletion', () => {
    let caId: string;

    beforeAll(async () => {
      caId = randomUUID();
      const caKeypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair.privateKey),
      };

      const caCert = generateCertificate({
        subject: { CN: 'Delete Audit CA', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair.publicKeyPem,
        signingKey: caKeyPair.privateKeyPem,
        selfSigned: true,
      });

      await db.insert(certificateAuthorities).values({
        id: caId,
        subjectDn: 'CN=Delete Audit CA,O=Test Org,C=US',
        serialNumber: caCert.serialNumber,
        notBefore: caCert.validity.notBefore,
        notAfter: caCert.validity.notAfter,
        kmsKeyId: 'test-delete-audit-ca-key',
        kmsCertificateId: 'test-delete-audit-kms-cert',
        status: 'revoked',
        revocationDate: new Date(),
        revocationReason: 'cessationOfOperation',
      });
    });

    afterAll(async () => {
      await db.delete(auditLog).where(and(eq(auditLog.entityType, 'ca'), eq(auditLog.entityId, caId))).execute();
    });

    it('should create audit log before deletion', async () => {
      const context = await createContext({
        req: {} as FastifyRequest,
        res: {} as FastifyReply,
      });
      const caller = appRouter.createCaller(context);

      await caller.ca.delete({
        id: caId,
        destroyKey: false,
      });

      // Check audit log was created and preserved
      const auditResult = await db.select().from(auditLog)
        .where(and(eq(auditLog.entityType, 'ca'), eq(auditLog.entityId, caId), eq(auditLog.operation, 'ca.delete')));

      expect(auditResult.length).toBeGreaterThan(0);
      const audit = auditResult[0];
      expect(audit.status).toBe('success');
      expect(audit.details).toBeDefined();

      const details = JSON.parse(audit.details!);
      expect(details.subjectDn).toBe('CN=Delete Audit CA,O=Test Org,C=US');
      expect(details.destroyKey).toBe(false);
    });
  });

  describe('destroyKey parameter', () => {
    let caWithKeyDestructionId: string;
    let caWithoutKeyDestructionId: string;

    beforeAll(async () => {
      // CA for key destruction test
      caWithKeyDestructionId = randomUUID();
      const caKeypair1 = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair1 = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair1.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair1.privateKey),
      };

      const caCert1 = generateCertificate({
        subject: { CN: 'Destroy Key CA', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair1.publicKeyPem,
        signingKey: caKeyPair1.privateKeyPem,
        selfSigned: true,
      });

      await db.insert(certificateAuthorities).values({
        id: caWithKeyDestructionId,
        subjectDn: 'CN=Destroy Key CA,O=Test Org,C=US',
        serialNumber: caCert1.serialNumber,
        notBefore: caCert1.validity.notBefore,
        notAfter: caCert1.validity.notAfter,
        kmsKeyId: 'test-destroy-key-ca-key',
        kmsCertificateId: 'test-destroy-key-kms-cert',
        status: 'revoked',
        revocationDate: new Date(),
        revocationReason: 'keyCompromise',
      });

      // CA for preservation test
      caWithoutKeyDestructionId = randomUUID();
      const caKeypair2 = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const caKeyPair2 = {
        publicKeyPem: forge.pki.publicKeyToPem(caKeypair2.publicKey),
        privateKeyPem: forge.pki.privateKeyToPem(caKeypair2.privateKey),
      };

      const caCert2 = generateCertificate({
        subject: { CN: 'Preserve Key CA', O: 'Test Org', C: 'US' },
        publicKey: caKeyPair2.publicKeyPem,
        signingKey: caKeyPair2.privateKeyPem,
        selfSigned: true,
      });

      await db.insert(certificateAuthorities).values({
        id: caWithoutKeyDestructionId,
        subjectDn: 'CN=Preserve Key CA,O=Test Org,C=US',
        serialNumber: caCert2.serialNumber,
        notBefore: caCert2.validity.notBefore,
        notAfter: caCert2.validity.notAfter,
        kmsKeyId: 'test-preserve-key-ca-key',
        kmsCertificateId: 'test-preserve-key-kms-cert',
        status: 'revoked',
        revocationDate: new Date(),
        revocationReason: 'superseded',
      });
    });

    afterAll(async () => {
      // Cleanup
    });

    it('should report keyDestroyed=false when destroyKey=false', async () => {
      const context = await createContext({
        req: {} as FastifyRequest,
        res: {} as FastifyReply,
      });
      const caller = appRouter.createCaller(context);

      const result = await caller.ca.delete({
        id: caWithoutKeyDestructionId,
        destroyKey: false,
      });

      expect(result.success).toBe(true);
      expect(result.keyDestroyed).toBe(false);
    });

    // Note: Testing destroyKey=true would require KMS integration
    // This is tested in integration tests with real KMS
  });
});
