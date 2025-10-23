import { describe, it, expect } from "vitest";
import { appRouter } from "../router.js";
import { createContext } from "../context.js";
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Integration test for CA creation
 * This test replicates what happens when the user clicks "Generate Sample Data" and then "Create"
 */
describe("CA Creation", () => {
  it("should create a root CA with sample data", async () => {
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

    console.log("✅ CA created successfully!");
    console.log(`   ID: ${result.id}`);
    console.log(`   Subject: ${result.subject}`);
    console.log(`   Serial: ${result.serialNumber}`);
  });
});
