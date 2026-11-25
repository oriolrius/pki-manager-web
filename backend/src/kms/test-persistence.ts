/**
 * KMS Persistence Test
 * Verifies that keys persist after container restart
 *
 * Usage: tsx src/kms/test-persistence.ts
 */

import { KMSClient } from "./client.js";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// The KMS compose project at the repository root (kms/), found from this file.
const KMS_DIR = fileURLToPath(new URL("../../../kms", import.meta.url));

async function waitForKMS(client: KMSClient, maxAttempts = 10): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const connected = await client.testConnection();
      if (connected) return true;
    } catch (error) {
      console.log(`   Waiting for KMS... (attempt ${i + 1}/${maxAttempts})`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

async function testPersistence() {
  console.log("🧪 Testing KMS Data Persistence...\n");

  const kmsClient = new KMSClient({
    url: process.env.KMS_URL || "http://localhost:42998",
  });

  let keyPair: { privateKeyId: string; publicKeyId: string } | null = null;

  try {
    // Step 1: Create a key pair
    console.log("1️⃣  Creating test key pair...");
    keyPair = await kmsClient.createKeyPair({
      sizeInBits: 2048,
      tags: ["persistence-test", "do-not-delete"],
    });
    console.log(`✅ Key pair created:`);
    console.log(`   Private Key ID: ${keyPair.privateKeyId}`);
    console.log(`   Public Key ID: ${keyPair.publicKeyId}\n`);

    // Step 2: Retrieve the public key to verify it exists
    console.log("2️⃣  Verifying key exists before restart...");
    const publicKeyBefore = await kmsClient.getPublicKey(keyPair.publicKeyId);
    console.log(`✅ Public key retrieved (${publicKeyBefore.length} bytes)\n`);

    // Step 3: Restart the KMS container
    console.log("3️⃣  Restarting KMS container...");
    console.log("   Stopping container...");
    execSync("docker compose down", {
      cwd: KMS_DIR,
      stdio: "pipe"
    });
    console.log("   Starting container...");
    execSync("docker compose up -d", {
      cwd: KMS_DIR,
      stdio: "pipe"
    });
    console.log("   Waiting for KMS to be ready...");

    const isReady = await waitForKMS(kmsClient);
    if (!isReady) {
      throw new Error("KMS did not come back online after restart");
    }
    console.log("✅ Container restarted successfully\n");

    // Step 4: Try to retrieve the same key after restart
    console.log("4️⃣  Verifying key still exists after restart...");
    const publicKeyAfter = await kmsClient.getPublicKey(keyPair.publicKeyId);
    console.log(`✅ Public key retrieved (${publicKeyAfter.length} bytes)\n`);

    // Step 5: Verify the keys are identical
    console.log("5️⃣  Comparing keys before and after restart...");
    if (publicKeyBefore === publicKeyAfter) {
      console.log("✅ Keys are identical - data persisted correctly!\n");
    } else {
      throw new Error("Keys differ - data persistence failed!");
    }

    // Step 6: Clean up
    console.log("6️⃣  Cleaning up test key pair...");
    await kmsClient.destroyKeyPair(keyPair.privateKeyId, keyPair.publicKeyId);
    console.log("✅ Test key pair destroyed\n");

    console.log("🎉 Persistence test passed! Data survives container restarts.\n");

  } catch (error) {
    console.error("❌ Persistence test failed:", error);

    // Attempt cleanup even on failure
    if (keyPair) {
      console.log("\n⚠️  Attempting cleanup...");
      try {
        await kmsClient.destroyKeyPair(keyPair.privateKeyId, keyPair.publicKeyId);
        console.log("✅ Cleanup successful");
      } catch (cleanupError) {
        console.error("❌ Cleanup failed:", cleanupError);
        console.log(`⚠️  Manual cleanup required for key: ${keyPair.privateKeyId}`);
      }
    }

    process.exit(1);
  }
}

// Run test
testPersistence().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
