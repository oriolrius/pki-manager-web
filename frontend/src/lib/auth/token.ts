/**
 * Token Storage Module
 *
 * Provides access to the current access token for use outside React components.
 * Used by tRPC client to inject Authorization headers.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { UserManager, type User } from 'oidc-client-ts';
import { buildOIDCSettings, isOIDCEnabled } from './config';

// Cached UserManager instance
let userManager: UserManager | null = null;

/**
 * Gets or creates the UserManager instance
 */
async function getUserManager(): Promise<UserManager | null> {
  if (!isOIDCEnabled()) {
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
 * Gets the current access token
 * Returns null if not authenticated or OIDC is disabled
 */
export async function getAccessToken(): Promise<string | null> {
  const user = await getUser();
  return user?.access_token ?? null;
}

/**
 * Clears the cached UserManager (useful for testing)
 */
export function resetUserManager(): void {
  userManager = null;
}
