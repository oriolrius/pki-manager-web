/**
 * Certificate Renewal Integration Tests
 *
 * Tests for certificate.renew endpoint with real KMS integration.
 * These tests require KMS to be running (docker compose up in kms/ directory).
 *
 * Tests validate:
 * 1. Certificate renewal with new key generation
 * 2. Certificate renewal with key reuse (for young certificates)
 * 3. Updated subject info during renewal
 * 4. Original certificate revocation option
 * 5. Validation errors (revoked certs, old certs for key reuse)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { appRouter } from "../router.js";
import { createContext } from "../context.js";
import { db } from "../../db/client.js";
import { certificateAuthorities, certificates } from "../../db/schema.js";
import type { FastifyRequest, FastifyReply } from "fastify";

// Store created entity IDs for cleanup
const createdCaIds: string[] = [];
const createdCertIds: string[] = [];

/**
 * Integration tests for Certificate Renewal with real KMS
 */
describe("Certificate Renew - KMS Integration", () => {
  let testCaId: string;
  let issuedCertId: string;
  let issuedCertSubject: string;

  // Create a real CA and certificate in KMS before all tests
  beforeAll(async () => {
    const randomString = Math.random().toString(36).substring(2, 8);

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Create a CA for issuing certificates
    // NOTE: Use unique naming pattern that won't be matched by other tests' LIKE cleanup patterns
    const caResult = await caller.ca.create({
      subject: {
        commonName: `RenewTestSuite-CA-${randomString.toUpperCase()}`,
        organization: "RenewTestSuite Org",
        organizationalUnit: "PKI RenewTests",
        country: "US",
        state: "New York",
        locality: "New York City",
      },
      keyAlgorithm: "RSA-4096",
      validityYears: 10,
    });

    testCaId = caResult.id;
    createdCaIds.push(testCaId);

    console.log(`✅ Test CA created: ${testCaId}`);

    // Issue a certificate for renewal testing
    const certResult = await caller.certificate.issue({
      caId: testCaId,
      certificateType: "server",
      subject: {
        commonName: `renew-test-${randomString}.example.com`,
        organization: "Renewal Test Server Org",
        country: "US",
      },
      keyAlgorithm: "RSA-4096",
      validityDays: 365,
      sanDns: [`renew-test-${randomString}.example.com`],
    });

    issuedCertId = certResult.id;
    issuedCertSubject = certResult.subject;
    createdCertIds.push(issuedCertId);

    console.log(`✅ Test certificate issued: ${issuedCertId}`);
  });

  afterAll(async () => {
    // IMPORTANT: Delete certificates first to avoid FOREIGN KEY constraint failures
    // Delete all certificates that reference our test CAs
    for (const caId of createdCaIds) {
      await db.delete(certificates).where(eq(certificates.caId, caId)).execute().catch(() => {});
    }
    // Also delete by explicit ID list
    for (const certId of createdCertIds) {
      await db.delete(certificates).where(eq(certificates.id, certId)).execute().catch(() => {});
    }
    // Now it's safe to delete the CAs
    for (const caId of createdCaIds) {
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute().catch(() => {});
    }
    // Clean up any remaining CAs from this test suite (in case of partial failures)
    await db.delete(certificateAuthorities).where(like(certificateAuthorities.subjectDn, '%RenewTestSuite%')).catch(() => {});
    console.log("✅ Test cleanup complete");
  });

  it("should renew a certificate with new key generation", async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.renew({
      id: issuedCertId,
      generateNewKey: true,
      validityDays: 365,
    });

    // Verify result
    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.id).not.toBe(issuedCertId); // New cert ID
    expect(result.renewedFromId).toBe(issuedCertId);
    expect(result.subject).toBe(issuedCertSubject); // Same subject by default
    expect(result.serialNumber).toBeDefined();
    expect(result.notBefore).toBeDefined();
    expect(result.notAfter).toBeDefined();
    expect(result.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(result.status).toBe("active");

    // Store for cleanup
    createdCertIds.push(result.id);

    // Verify renewed certificate in database
    const dbCert = await db.select().from(certificates).where(eq(certificates.id, result.id));
    expect(dbCert).toHaveLength(1);
    expect(dbCert[0].caId).toBe(testCaId);
    expect(dbCert[0].renewedFromId).toBe(issuedCertId);
    expect(dbCert[0].status).toBe("active");
    expect(dbCert[0].kmsCertificateId).toBeDefined();
    expect(dbCert[0].kmsKeyId).toBeDefined(); // New key was generated

    console.log(`✅ Certificate renewed with new key: ${result.id}`);
  });

  it("should renew a certificate with key reuse (young cert)", async () => {
    // First issue a new cert that's young enough for key reuse (< 90 days)
    const randomString = Math.random().toString(36).substring(2, 8);
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Issue a fresh certificate
    const freshCert = await caller.certificate.issue({
      caId: testCaId,
      certificateType: "server",
      subject: {
        commonName: `keyreuse-${randomString}.example.com`,
        organization: "Key Reuse Test Org",
        country: "US",
      },
      keyAlgorithm: "RSA-4096",
      validityDays: 365,
      sanDns: [`keyreuse-${randomString}.example.com`],
    });

    createdCertIds.push(freshCert.id);

    // Now renew with key reuse
    const result = await caller.certificate.renew({
      id: freshCert.id,
      generateNewKey: false, // Reuse existing key
      validityDays: 365,
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.renewedFromId).toBe(freshCert.id);
    expect(result.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(result.status).toBe("active");

    // Store for cleanup
    createdCertIds.push(result.id);

    // Verify that kmsKeyId is null (reused key, not stored again)
    const dbCert = await db.select().from(certificates).where(eq(certificates.id, result.id));
    expect(dbCert).toHaveLength(1);
    expect(dbCert[0].kmsKeyId).toBeNull(); // Key was reused, not regenerated

    console.log(`✅ Certificate renewed with key reuse: ${result.id}`);
  });

  it("should renew a certificate with updated subject info", async () => {
    const randomString = Math.random().toString(36).substring(2, 8);
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Issue a certificate to renew
    const originalCert = await caller.certificate.issue({
      caId: testCaId,
      certificateType: "server",
      subject: {
        commonName: `update-${randomString}.example.com`,
        organization: "Original Org",
        country: "US",
      },
      keyAlgorithm: "RSA-4096",
      validityDays: 365,
      sanDns: [`update-${randomString}.example.com`],
    });

    createdCertIds.push(originalCert.id);

    // Renew with updated info
    const result = await caller.certificate.renew({
      id: originalCert.id,
      generateNewKey: true,
      validityDays: 730,
      updateInfo: true,
      subject: {
        commonName: `updated-${randomString}.example.com`,
        organization: "Updated Organization",
        country: "US",
        state: "California",
      },
      sanDns: [`updated-${randomString}.example.com`, `www.updated-${randomString}.example.com`],
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.renewedFromId).toBe(originalCert.id);
    expect(result.subject).toContain(`updated-${randomString}.example.com`);
    expect(result.subject).toContain("Updated Organization");

    createdCertIds.push(result.id);

    console.log(`✅ Certificate renewed with updated info: ${result.id}`);
  });

  it("should renew and revoke the original certificate", async () => {
    const randomString = Math.random().toString(36).substring(2, 8);
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Issue a certificate to renew
    const originalCert = await caller.certificate.issue({
      caId: testCaId,
      certificateType: "server",
      subject: {
        commonName: `revoke-original-${randomString}.example.com`,
        organization: "Revoke Original Org",
        country: "US",
      },
      keyAlgorithm: "RSA-4096",
      validityDays: 365,
      sanDns: [`revoke-original-${randomString}.example.com`],
    });

    createdCertIds.push(originalCert.id);

    // Renew and revoke original
    const result = await caller.certificate.renew({
      id: originalCert.id,
      generateNewKey: true,
      validityDays: 365,
      revokeOriginal: true,
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.renewedFromId).toBe(originalCert.id);
    expect(result.status).toBe("active");

    createdCertIds.push(result.id);

    // Verify original certificate was revoked
    const dbOriginal = await db.select().from(certificates).where(eq(certificates.id, originalCert.id));
    expect(dbOriginal).toHaveLength(1);
    expect(dbOriginal[0].status).toBe("revoked");
    expect(dbOriginal[0].revocationReason).toBe("superseded");

    console.log(`✅ Certificate renewed and original revoked: ${result.id}`);
  });

  it("should reject renewal of non-existent certificate", async () => {
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.renew({
        id: "non-existent-cert-id",
        generateNewKey: true,
      })
    ).rejects.toThrow("not found");
  });

  it("should reject renewal of revoked certificate", async () => {
    const randomString = Math.random().toString(36).substring(2, 8);
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Issue a certificate
    const cert = await caller.certificate.issue({
      caId: testCaId,
      certificateType: "server",
      subject: {
        commonName: `revoked-renew-${randomString}.example.com`,
        organization: "Revoked Renew Test Org",
        country: "US",
      },
      keyAlgorithm: "RSA-4096",
      validityDays: 365,
      sanDns: [`revoked-renew-${randomString}.example.com`],
    });

    createdCertIds.push(cert.id);

    // Revoke it
    await caller.certificate.revoke({
      id: cert.id,
      reason: "keyCompromise",
    });

    // Try to renew - should fail
    await expect(
      caller.certificate.renew({
        id: cert.id,
        generateNewKey: true,
      })
    ).rejects.toThrow("Cannot renew a revoked certificate");
  });
});
