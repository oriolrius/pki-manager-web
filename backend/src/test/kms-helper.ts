/**
 * KMS Test Helper
 *
 * Provides utilities for tests that require KMS integration.
 * - Checks KMS availability before running integration tests
 * - Allows tests to skip gracefully when KMS is not available
 * - Caches the KMS availability check for performance
 */

let kmsAvailabilityCache: boolean | null = null;
let kmsCheckPromise: Promise<boolean> | null = null;

/**
 * Check if KMS is available by making a health check request.
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
  kmsCheckPromise = checkKmsHealth();
  kmsAvailabilityCache = await kmsCheckPromise;
  kmsCheckPromise = null;

  return kmsAvailabilityCache;
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
