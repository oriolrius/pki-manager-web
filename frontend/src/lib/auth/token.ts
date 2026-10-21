/**
 * Token Storage Module
 *
 * Owns the single oidc-client-ts `UserManager` shared by the React `AuthProvider` and by
 * code outside React (the tRPC client, which needs the access token for its
 * Authorization header). One instance means one token store and one renewal timer, so
 * the provider's `automaticSilentRenew` and the on-demand renewal below never race each
 * other with the same refresh token.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { UserManager, type User } from 'oidc-client-ts';
import { buildOIDCSettings, isOIDCEnabledAsync, getAuthority, getClientId } from './config';

// Cached UserManager instance (and the in-flight creation, so concurrent callers share it)
let userManagerPromise: Promise<UserManager | null> | null = null;

// Renew the token this many seconds before it actually expires, so a request is
// never sent with a token that lapses in flight.
const TOKEN_REFRESH_BUFFER_SECONDS = 60;

// In-flight renewal, shared across concurrent callers (window-focus refetches and
// multiple links can race) so we hit the token endpoint at most once per expiry.
let renewPromise: Promise<User | null> | null = null;

/**
 * Drops a token blob left by the pre-3.13 hand-rolled login flow. It used the same
 * storage key the library uses (`oidc.user:<authority>:<clientId>`) but stored raw
 * tokens without a `profile`, which the library would otherwise load as a user with
 * no claims. The affected user simply logs in once more.
 */
async function removeLegacyManualTokens(): Promise<void> {
  const key = `oidc.user:${await getAuthority()}:${await getClientId()}`;
  const stored = localStorage.getItem(key);
  if (!stored) {
    return;
  }
  try {
    if (!('profile' in JSON.parse(stored))) {
      localStorage.removeItem(key);
    }
  } catch {
    localStorage.removeItem(key);
  }
}

async function createUserManager(): Promise<UserManager | null> {
  if (!(await isOIDCEnabledAsync())) {
    return null;
  }
  await removeLegacyManualTokens();
  return new UserManager(await buildOIDCSettings());
}

/**
 * Gets or creates the shared UserManager instance (null when OIDC is disabled).
 */
export function getUserManager(): Promise<UserManager | null> {
  if (!userManagerPromise) {
    userManagerPromise = createUserManager().catch((error) => {
      userManagerPromise = null;
      throw error;
    });
  }
  return userManagerPromise;
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
 * Renews the session through the library (refresh_token grant when the provider issued
 * one, otherwise a silent iframe request). Resolves to null when renewal is impossible
 * (e.g. the SSO session ended); the library then reports the user as signed out and
 * AuthGuard redirects to the provider.
 */
async function renewUser(manager: UserManager): Promise<User | null> {
  try {
    return await manager.signinSilent();
  } catch (error) {
    console.warn('[Auth] Token renewal failed:', error);
    return null;
  }
}

/**
 * Gets the current access token
 * Returns null if not authenticated or OIDC is disabled.
 *
 * Transparently renews the token when it is expired or about to expire, so callers
 * never receive a stale token while the session is still renewable.
 */
export async function getAccessToken(): Promise<string | null> {
  const manager = await getUserManager();
  if (!manager) {
    return null;
  }

  const user = await getUser();
  if (!user?.access_token) {
    return null;
  }

  const expiringSoon =
    user.expires_in !== undefined && user.expires_in < TOKEN_REFRESH_BUFFER_SECONDS;
  if (!expiringSoon) {
    return user.access_token;
  }

  // Single-flight: share one renewal across concurrent callers.
  if (!renewPromise) {
    renewPromise = renewUser(manager).finally(() => {
      renewPromise = null;
    });
  }
  return (await renewPromise)?.access_token ?? null;
}

/**
 * Clears the cached UserManager (useful for testing)
 */
export function resetUserManager(): void {
  userManagerPromise = null;
}

/**
 * Clears the in-flight renewal promise (useful for testing).
 */
export function resetTokenRefreshState(): void {
  renewPromise = null;
}
