/**
 * Token Storage Module
 *
 * Provides access to the current access token for use outside React components.
 * Used by tRPC client to inject Authorization headers.
 *
 * The production login uses the hand-rolled manual token flow (see
 * `routes/callback.tsx`), which stores tokens in localStorage but is NOT managed
 * by oidc-client-ts's UserManager — so its `automaticSilentRenew` never fires for
 * these tokens. To avoid unauthenticated (401) requests after the short-lived
 * access token expires mid-session, `getManualAccessToken()` transparently
 * renews the token on demand using the stored `refresh_token` (single-flight).
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { UserManager, type User } from 'oidc-client-ts';
import {
  buildOIDCSettings,
  isOIDCEnabledAsync,
  getStorageKeyAsync,
  getAuthority,
  getClientId,
} from './config';

// Cached UserManager instance
let userManager: UserManager | null = null;

// Renew the token this many seconds before it actually expires, so a request is
// never sent with a token that lapses in flight.
const TOKEN_REFRESH_BUFFER_SECONDS = 60;

// Shape of the manual token blob written by the callback / refresh flow.
interface StoredTokens {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number;
}

// In-flight refresh, shared across concurrent callers (a batched tRPC request
// calls getAccessToken() once, but window-focus refetches and multiple links can
// race) so we hit the token endpoint at most once per expiry.
let refreshPromise: Promise<string | null> | null = null;

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

function readStoredTokens(storageKey: string): StoredTokens | null {
  const stored = localStorage.getItem(storageKey);
  if (!stored) {
    return null;
  }
  try {
    return JSON.parse(stored) as StoredTokens;
  } catch {
    return null;
  }
}

/**
 * Renews the manually-stored access token using its refresh_token via the
 * OIDC token endpoint (refresh_token grant, public client — no secret).
 *
 * On success the rotated tokens are persisted and the new access token is
 * returned. On failure the stored token is cleared so AuthGuard falls back to a
 * login redirect (the same recovery a full page reload triggers).
 */
async function refreshManualAccessToken(
  storageKey: string,
  refreshToken: string
): Promise<string | null> {
  const [authority, clientId] = await Promise.all([getAuthority(), getClientId()]);
  try {
    const response = await fetch(`${authority}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      // The refresh token is invalid/expired (e.g. the SSO session lapsed).
      // Drop the stale token so the app stops retrying and re-authenticates.
      console.warn('[Auth] Token refresh failed:', response.status);
      localStorage.removeItem(storageKey);
      return null;
    }

    const tokens = (await response.json()) as {
      access_token: string;
      id_token?: string;
      refresh_token?: string;
      token_type?: string;
      expires_in: number;
    };

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        access_token: tokens.access_token,
        id_token: tokens.id_token,
        // Keycloak rotates the refresh token; keep the old one if none returned.
        refresh_token: tokens.refresh_token ?? refreshToken,
        token_type: tokens.token_type,
        expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
      })
    );

    console.debug('[Auth] Access token refreshed');
    return tokens.access_token;
  } catch (error) {
    // Network error — leave the stored token in place so a later attempt can
    // still refresh, and let this request go out unauthenticated (401) rather
    // than logging the user out on a transient blip.
    console.warn('[Auth] Token refresh error:', error);
    return null;
  }
}

/**
 * Gets access token from manual storage
 * Used when tokens were exchanged via manual token flow.
 *
 * Transparently refreshes via the stored refresh_token when the token is
 * expired or about to expire, so callers never receive a stale/absent token
 * while the session is still renewable.
 */
async function getManualAccessToken(): Promise<string | null> {
  try {
    const storageKey = await getStorageKeyAsync();
    console.debug('[Auth] Looking for token with key:', storageKey);
    const data = readStoredTokens(storageKey);
    if (!data?.access_token) {
      console.debug('[Auth] No token found in localStorage');
      return null;
    }

    // Refresh when the token is expired or within the renewal buffer.
    const now = Math.floor(Date.now() / 1000);
    const expiringSoon =
      data.expires_at != null && data.expires_at < now + TOKEN_REFRESH_BUFFER_SECONDS;

    if (expiringSoon) {
      if (!data.refresh_token) {
        console.debug('[Auth] Token expired and no refresh_token available');
        return null;
      }
      console.debug('[Auth] Token expiring — refreshing via refresh_token');
      // Single-flight: share one refresh across concurrent callers.
      if (!refreshPromise) {
        refreshPromise = refreshManualAccessToken(storageKey, data.refresh_token).finally(
          () => {
            refreshPromise = null;
          }
        );
      }
      return await refreshPromise;
    }

    console.debug('[Auth] Valid token found in localStorage');
    return data.access_token;
  } catch (error) {
    console.warn('[Auth] Error retrieving manual access token:', error);
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

  // Fall back to manually stored token (with on-demand refresh)
  return getManualAccessToken();
}

/**
 * Clears the cached UserManager (useful for testing)
 */
export function resetUserManager(): void {
  userManager = null;
}

/**
 * Clears the in-flight refresh promise (useful for testing).
 */
export function resetTokenRefreshState(): void {
  refreshPromise = null;
}
