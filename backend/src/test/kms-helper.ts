/**
 * KMS Test Helper
 *
 * Provides utilities for tests that require KMS integration.
 * - Checks KMS availability before running integration tests
 * - Automatically starts KMS via docker compose if not available
 * - Allows tests to skip gracefully when KMS cannot be started
 * - Caches the KMS availability check for performance
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

let kmsAvailabilityCache: boolean | null = null;
let kmsCheckPromise: Promise<boolean> | null = null;

/**
 * Check if KMS is available by making a health check request.
 * If KMS is not available, attempts to start it via docker compose.
 * Results are cached to avoid repeated network calls.
 */
export async function isKmsAvailable(): Promise<boolean> {
  // Return cached result if available
  if (kmsAvailabilityCache !== null) {
    return kmsAvailabilityCache;
  }

  // If a check is already in progress, wait for it
  if (kmsCheckPromise) {
    return kmsCheckPromise;
  }

  // Start a new check
  kmsCheckPromise = checkAndStartKms();
  kmsAvailabilityCache = await kmsCheckPromise;
  kmsCheckPromise = null;

  return kmsAvailabilityCache;
}

/**
 * Check if KMS is available, and if not, try to start it
 */
async function checkAndStartKms(): Promise<boolean> {
  // First, check if KMS is already running
  const isHealthy = await checkKmsHealth();
  if (isHealthy) {
    return true;
  }

  // KMS is not running, try to start it
  return tryStartKms();
}

/**
 * Internal function to check KMS health endpoint
 */
async function checkKmsHealth(): Promise<boolean> {
  const kmsUrl = process.env.KMS_URL || 'http://localhost:42998';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

    const response = await fetch(`${kmsUrl}/version`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Find the KMS docker-compose directory
 */
function findKmsDockerComposeDir(): string | null {
  // Get the directory of this file
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Navigate from backend/src/test to pki-manager/kms (3 levels up to backend, then to kms)
  const kmsDir = resolve(__dirname, '..', '..', '..', 'kms');
  const dockerComposePath = resolve(kmsDir, 'docker-compose.yml');

  if (existsSync(dockerComposePath)) {
    return kmsDir;
  }

  return null;
}

/**
 * Try to start KMS via docker compose
 * @returns true if KMS was started successfully, false otherwise
 */
async function tryStartKms(): Promise<boolean> {
  const kmsDir = findKmsDockerComposeDir();

  if (!kmsDir) {
    console.log('  ⚠️  KMS docker-compose.yml not found');
    return false;
  }

  console.log('  🚀 KMS not running, attempting to start via docker compose...');

  try {
    // Start docker compose
    execSync('docker compose up -d', {
      cwd: kmsDir,
      stdio: 'pipe',
      timeout: 60000, // 60 second timeout
    });

    console.log('  ⏳ Waiting for KMS to become healthy...');

    // Wait for KMS to become healthy (max 90 seconds)
    // Note: KMS docker-compose has start_period: 40s + interval: 30s, so we need ~70s minimum
    const maxWaitTime = 90000;
    const checkInterval = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const isHealthy = await checkKmsHealth();
      if (isHealthy) {
        console.log('  ✅ KMS started successfully');
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    console.log('  ⚠️  KMS started but health check timed out');
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ⚠️  Failed to start KMS: ${message}`);
    return false;
  }
}

/**
 * Reset the KMS availability cache.
 * Useful for testing or when KMS status might have changed.
 */
export function resetKmsCache(): void {
  kmsAvailabilityCache = null;
  kmsCheckPromise = null;
}

/**
 * Check KMS availability synchronously from cache.
 * Must be called after isKmsAvailable() has been awaited.
 * Returns false if cache is not populated.
 */
export function isKmsAvailableSync(): boolean {
  return kmsAvailabilityCache === true;
}

/**
 * Initialize KMS availability check.
 * Call this in a beforeAll hook to populate the cache.
 * Returns true if KMS is available, false otherwise.
 */
export async function initKmsCheck(): Promise<boolean> {
  const available = await isKmsAvailable();
  if (!available) {
    console.log('\n  ⚠️  KMS is not available - some tests will be skipped');
    console.log('     Start KMS with: cd kms && docker compose up -d\n');
  }
  return available;
}

/**
 * Get a message for skipped tests when KMS is unavailable
 */
export function getKmsSkipMessage(): string {
  return 'KMS is not available (start with: cd kms && docker compose up -d)';
}
