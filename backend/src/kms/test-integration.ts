/**
 * KMS Integration Test
 * Run this script to test the KMS client and service
 *
 * Usage: tsx src/kms/test-integration.ts
 */

import { KMSClient } from "./client.js";

async function testKMSIntegration() {
  console.log("🧪 Testing KMS Integration...\n");

  // Initialize KMS client
  const kmsClient = new KMSClient({
    url: process.env.KMS_URL || "http://localhost:42998",
  });

  try {
    // Test 1: Connection test
    console.log("1️⃣  Testing connection...");
    const connectionOk = await kmsClient.testConnection();
    if (connectionOk) {
      console.log("✅ Connection successful\n");
    } else {
      console.log("❌ Connection failed\n");
      return;
    }

    // Test 2: Create key pair
    console.log("2️⃣  Creating RSA key pair...");
    const keyPair = await kmsClient.createKeyPair({
      sizeInBits: 2048,
      tags: ["test", "integration"],
    });
    console.log(`✅ Key pair created:`);
    console.log(`   Private Key ID: ${keyPair.privateKeyId}`);
    console.log(`   Public Key ID: ${keyPair.publicKeyId}\n`);

    // Test 3: Get public key
    console.log("3️⃣  Retrieving public key...");
    const publicKeyPem = await kmsClient.getPublicKey(keyPair.publicKeyId);
    console.log(`✅ Public key retrieved (${publicKeyPem.length} bytes)`);
    console.log(`   Preview: ${publicKeyPem.substring(0, 80)}...\n`);

    // Test 4: Revoke and destroy key pair
    console.log("4️⃣  Revoking and destroying key pair...");
    await kmsClient.destroyKeyPair(keyPair.privateKeyId, keyPair.publicKeyId);
    console.log("✅ Key pair destroyed\n");

    console.log("🎉 All tests passed!\n");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run tests
testKMSIntegration().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
