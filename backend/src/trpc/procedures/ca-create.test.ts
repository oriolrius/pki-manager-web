import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "../router.js";
import { createContext } from "../context.js";
import { db } from "../../db/client.js";
import { certificateAuthorities } from "../../db/schema.js";
import { isKmsAvailable } from "../../test/kms-helper.js";
import type { FastifyRequest, FastifyReply } from "fastify";

// Store created CA IDs for cleanup
const createdCaIds: string[] = [];

// node-forge extension objects reach the tRPC caller loosely typed as {};
// narrow just the flags the assertions below read.
type BasicConstraintsExt = { cA?: boolean };
type KeyUsageExt = { keyCertSign?: boolean; cRLSign?: boolean };

/**
 * Integration test for CA creation
 * This test replicates what happens when the user clicks "Generate Sample Data" and then "Create"
 * Tests will be SKIPPED if KMS is not available.
 */
describe("CA Creation", () => {
  let kmsAvailable: boolean;

  beforeAll(async () => {
    kmsAvailable = await isKmsAvailable();
    if (!kmsAvailable) {
      console.log("  ⚠️  Skipping CA creation tests - KMS not available");
    }
  });

  afterAll(async () => {
    // Clean up all CAs created during tests
    for (const caId of createdCaIds) {
      await db.delete(certificateAuthorities).where(eq(certificateAuthorities.id, caId)).execute().catch(() => {});
    }
  });

  it("should create a root CA with sample data", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }
    // Generate random sample data (same logic as frontend's generateRandomData function)
    const randomString = Math.random().toString(36).substring(2, 8);
    const orgs = [
      "Acme Corp",
      "Test Inc",
      "Demo LLC",
      "Sample Ltd",
      "Enterprise CA",
      "Trust Services",
    ];
    const countries = ["US", "GB", "DE", "FR", "ES", "IT", "CA"];
    const states = [
      "California",
      "New York",
      "Texas",
      "Florida",
      "Washington",
    ];
    const cities = [
      "San Francisco",
      "New York",
      "Austin",
      "Miami",
      "Seattle",
    ];

    const randomOrg = orgs[Math.floor(Math.random() * orgs.length)];
    const randomCountry = countries[Math.floor(Math.random() * countries.length)];
    const randomState = states[Math.floor(Math.random() * states.length)];
    const randomCity = cities[Math.floor(Math.random() * cities.length)];

    // Create a tRPC context with database
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });

    // Create a tRPC caller (simulates an API call)
    const caller = appRouter.createCaller(context);

    // Call the CA creation endpoint with the sample data
    const result = await caller.ca.create({
      subject: {
        commonName: `${randomOrg} Root CA ${randomString.toUpperCase()}`,
        organization: randomOrg,
        organizationalUnit: "PKI Division",
        country: randomCountry,
        state: randomState,
        locality: randomCity,
      },
      keyAlgorithm: "RSA-4096",
      validityYears: 20,
    });

    // Verify the result (minimal schema - certificatePem is in KMS only)
    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.subject).toContain(randomOrg);
    expect(result.notBefore).toBeDefined();
    expect(result.notAfter).toBeDefined();
    expect(result.serialNumber).toBeDefined();
    expect(result.status).toBe("active");

    // Store CA ID for cleanup
    createdCaIds.push(result.id);

    console.log("✅ CA created successfully!");
    console.log(`   ID: ${result.id}`);
    console.log(`   Subject: ${result.subject}`);
    console.log(`   Serial: ${result.serialNumber}`);
  });

  it("should create a CA with proper X.509 extensions (basicConstraints CA:TRUE, keyUsage)", async (ctx) => {
    if (!kmsAvailable) {
      ctx.skip();
      return;
    }

    const randomString = Math.random().toString(36).substring(2, 8);

    // Create a tRPC context with database
    const context = await createContext({
      req: {} as FastifyRequest,
      res: {} as FastifyReply,
    });

    // Create a tRPC caller
    const caller = appRouter.createCaller(context);

    // Create a CA
    const createResult = await caller.ca.create({
      subject: {
        commonName: `X509 Extensions Test CA ${randomString}`,
        organization: "Test Org",
        country: "US",
      },
      keyAlgorithm: "RSA-4096",
      validityYears: 10,
    });

    createdCaIds.push(createResult.id);

    // Fetch the CA details which include certificate and extensions
    const caDetails = await caller.ca.getById({ id: createResult.id });

    // Verify basicConstraints extension is present with CA:TRUE
    // Per RFC 5280, CA certificates MUST have basicConstraints with cA=true
    expect(caDetails.extensions).toBeDefined();
    const basicConstraints = caDetails.extensions?.basicConstraints as BasicConstraintsExt | undefined;
    expect(basicConstraints).toBeDefined();
    expect(basicConstraints?.cA).toBe(true);

    // Verify keyUsage extension includes keyCertSign and cRLSign
    // Per RFC 5280, if keyUsage is present for CA certificates, keyCertSign SHOULD be set
    expect(caDetails.extensions?.keyUsage).toBeDefined();
    const keyUsage = caDetails.extensions?.keyUsage as KeyUsageExt | undefined;
    expect(keyUsage?.keyCertSign).toBe(true);
    expect(keyUsage?.cRLSign).toBe(true);

    console.log("✅ CA created with proper X.509 extensions!");
    console.log(`   basicConstraints.cA: ${basicConstraints?.cA}`);
    console.log(`   keyUsage.keyCertSign: ${keyUsage?.keyCertSign}`);
    console.log(`   keyUsage.cRLSign: ${keyUsage?.cRLSign}`);
  });
});
