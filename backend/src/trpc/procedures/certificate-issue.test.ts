/**
 * Certificate Issue Integration Tests
 *
 * Tests for certificate.issue endpoint with real KMS integration.
 * These tests require KMS to be running (docker compose up in kms/ directory).
 * Tests will be SKIPPED if KMS is not available.
 *
 * Tests validate:
 * 1. Certificate issuance with KMS key generation and signing
 * 2. Certificate type-specific validations (server, client, code_signing, email)
 * 3. SAN validations (DNS, IP, email)
 * 4. Validity period validations
 * 5. Certificate stored in database with correct metadata
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "../router.js";
import { createContext } from "../context.js";
import { db } from "../../db/client.js";
import { certificateAuthorities, certificates } from "../../db/schema.js";
import { isKmsAvailable } from "../../test/kms-helper.js";
import type { FastifyRequest, FastifyReply } from "fastify";

// Store created entity IDs for cleanup
const createdCaIds: string[] = [];
const createdCertIds: string[] = [];

/**
 * Integration tests for Certificate Issuance with real KMS
 */
describe("Certificate Issue - KMS Integration", () => {
  let testCaId: string;
  let kmsAvailable: boolean;

  // Check KMS availability and create a real CA in KMS before all tests
  beforeAll(async () => {
    kmsAvailable = await isKmsAvailable();
    if (!kmsAvailable) {
      console.log("  ⚠️  Skipping KMS integration tests - KMS not available");
      return;
    }

    const randomString = Math.random().toString(36).substring(2, 8);

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    // Create a CA for issuing certificates
    const caResult = await caller.ca.create({
      subject: {
        commonName: `Test CA for Certs ${randomString.toUpperCase()}`,
        organization: "Integration Test Org",
        organizationalUnit: "PKI Testing",
        country: "US",
        state: "California",
        locality: "San Francisco",
      },
      keyAlgorithm: "RSA-4096",
      validityYears: 10,
    });

    testCaId = caResult.id;
    createdCaIds.push(testCaId);

    console.log(`✅ Test CA created: ${testCaId}`);
  });

  afterAll(async () => {
    // Clean up all certificates created during tests
    for (const certId of createdCertIds) {
      await db.delete(certificates).where(eq(certificates.id, certId)).execute().catch(() => {});
    }
    // Clean up all CAs created during tests
    for (const caId of createdCaIds) {
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute().catch(() => {});
    }
    if (createdCaIds.length > 0 || createdCertIds.length > 0) {
      console.log("✅ Test cleanup complete");
    }
  });

  it("should issue a server certificate with DNS SANs", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const randomString = Math.random().toString(36).substring(2, 8);
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.issue({
      caId: testCaId,
      certificateType: "server",
      subject: {
        commonName: `server-${randomString}.example.com`,
        organization: "Test Server Org",
        country: "US",
      },
      keyAlgorithm: "RSA-4096",
      validityDays: 365,
      sanDns: [`server-${randomString}.example.com`, `www.server-${randomString}.example.com`],
    });

    // Verify result
    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.subject).toContain(`server-${randomString}.example.com`);
    expect(result.serialNumber).toBeDefined();
    expect(result.notBefore).toBeDefined();
    expect(result.notAfter).toBeDefined();
    expect(result.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(result.status).toBe("active");

    // Store for cleanup
    createdCertIds.push(result.id);

    // Verify certificate in database
    const dbCert = await db.select().from(certificates).where(eq(certificates.id, result.id));
    expect(dbCert).toHaveLength(1);
    expect(dbCert[0].caId).toBe(testCaId);
    expect(dbCert[0].certificateType).toBe("server");
    expect(dbCert[0].status).toBe("active");
    expect(dbCert[0].kmsCertificateId).toBeDefined();
    expect(dbCert[0].kmsKeyId).toBeDefined();

    console.log(`✅ Server certificate issued: ${result.id}`);
  });

  it("should issue a client certificate with email CN", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const randomString = Math.random().toString(36).substring(2, 8);
    const email = `user-${randomString}@example.com`;

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.issue({
      caId: testCaId,
      certificateType: "client",
      subject: {
        commonName: email,
        organization: "Test Client Org",
        country: "US",
      },
      keyAlgorithm: "RSA-4096",
      validityDays: 365,
      sanEmail: [email],
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.subject).toContain(email);
    expect(result.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(result.status).toBe("active");

    createdCertIds.push(result.id);

    console.log(`✅ Client certificate issued: ${result.id}`);
  });

  it("should issue an email protection certificate", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const randomString = Math.random().toString(36).substring(2, 8);
    const email = `secure-${randomString}@example.com`;

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.issue({
      caId: testCaId,
      certificateType: "email",
      subject: {
        commonName: "Secure User",
        organization: "Test Email Org",
        country: "US",
      },
      keyAlgorithm: "RSA-4096",
      validityDays: 365,
      sanEmail: [email],
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(result.status).toBe("active");

    createdCertIds.push(result.id);

    console.log(`✅ Email protection certificate issued: ${result.id}`);
  });

  it("should issue a code signing certificate with RSA-4096", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const randomString = Math.random().toString(36).substring(2, 8);

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    const result = await caller.certificate.issue({
      caId: testCaId,
      certificateType: "code_signing",
      subject: {
        commonName: `Code Signer ${randomString}`,
        organization: "Test Code Signing Corp",
        country: "US",
      },
      keyAlgorithm: "RSA-4096",
      validityDays: 730,
    });

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.subject).toContain(`Code Signer ${randomString}`);
    expect(result.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(result.status).toBe("active");

    createdCertIds.push(result.id);

    console.log(`✅ Code signing certificate issued: ${result.id}`);
  });

  it("should reject server certificate with invalid domain CN", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId: testCaId,
        certificateType: "server",
        subject: {
          commonName: "invalid domain with spaces",
          organization: "Test Org",
          country: "US",
        },
        keyAlgorithm: "RSA-4096",
        validityDays: 365,
      })
    ).rejects.toThrow("Invalid common name");
  });

  it("should reject server certificate with validity > 825 days", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId: testCaId,
        certificateType: "server",
        subject: {
          commonName: "valid.example.com",
          organization: "Test Org",
          country: "US",
        },
        keyAlgorithm: "RSA-4096",
        validityDays: 900, // > 825 days
      })
    ).rejects.toThrow("validity");
  });

  it("should reject code signing certificate with RSA-2048", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId: testCaId,
        certificateType: "code_signing",
        subject: {
          commonName: "Code Signer",
          organization: "Test Corp",
          country: "US",
        },
        keyAlgorithm: "RSA-2048", // Too weak for code signing
        validityDays: 730,
      })
    ).rejects.toThrow("Code signing certificates require RSA-3072, RSA-4096, or ECDSA-P256 minimum");
  });

  it("should reject email certificate without email SANs", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId: testCaId,
        certificateType: "email",
        subject: {
          commonName: "John Doe",
          organization: "Test Org",
          country: "US",
        },
        keyAlgorithm: "RSA-4096",
        validityDays: 365,
        // No sanEmail provided
      })
    ).rejects.toThrow("Email protection certificates require at least one email address in SANs");
  });

  it("should reject email certificate with mixed domains", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId: testCaId,
        certificateType: "email",
        subject: {
          commonName: "John Doe",
          organization: "Test Org",
          country: "US",
        },
        keyAlgorithm: "RSA-4096",
        validityDays: 365,
        sanEmail: ["user@example.com", "admin@different.com"],
      })
    ).rejects.toThrow("All email addresses must be from the same domain");
  });

  it("should reject certificate for non-existent CA", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });
    const caller = appRouter.createCaller(context);

    await expect(
      caller.certificate.issue({
        caId: "non-existent-ca-id",
        certificateType: "server",
        subject: {
          commonName: "test.example.com",
          organization: "Test Org",
          country: "US",
        },
        keyAlgorithm: "RSA-4096",
        validityDays: 365,
      })
    ).rejects.toThrow("not found");
  });
});
