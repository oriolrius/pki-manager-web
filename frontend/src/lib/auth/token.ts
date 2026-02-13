/**
 * Token Storage Module
 *
 * Provides access to the current access token for use outside React components.
 * Used by tRPC client to inject Authorization headers.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { UserManager, type User } from 'oidc-client-ts';
import { buildOIDCSettings, isOIDCEnabledAsync, getStorageKey } from './config';

// Cached UserManager instance
let userManager: UserManager | null = null;

/**
 * Gets or creates the UserManager instance
 */
async function getUserManager(): Promise<UserManager | null> {
  const oidcEnabled = await isOIDCEnabledAsync();
  if (!oidcEnabled) {
    return null;
  }

  if (!userManager) {
    const settings = await buildOIDCSettings();
    userManager = new UserManager(settings);
  }

  return userManager;
}

/**
 * Gets the current user from the UserManager
 */
export async function getUser(): Promise<User | null> {
  const manager = await getUserManager();
  if (!manager) {
    return null;
  }

  try {
    return await manager.getUser();
  } catch {
    return null;
  }
}

/**
 * Gets access token from manual storage
 * Used when tokens were exchanged via manual token flow
 */
function getManualAccessToken(): string | null {
  try {
    const storageKey = getStorageKey();
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;

    const data = JSON.parse(stored);
    if (!data.access_token) return null;

    // Check expiration (with 30 second buffer)
    if (data.expires_at) {
      const now = Math.floor(Date.now() / 1000);
      if (data.expires_at < now + 30) return null;
    }

    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * Gets the current access token
 * Returns null if not authenticated or OIDC is disabled
 * Checks both library storage and manual token storage
 */
export async function getAccessToken(): Promise<string | null> {
  // First try the library's UserManager
  const user = await getUser();
  if (user?.access_token) {
    return user.access_token;
  }

  // Fall back to manually stored token
  return getManualAccessToken();
}

/**
 * Clears the cached UserManager (useful for testing)
 */
export function resetUserManager(): void {
  userManager = null;
}
