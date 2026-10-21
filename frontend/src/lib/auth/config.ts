/**
 * OIDC Configuration
 *
 * Provider-agnostic OIDC configuration that works with any compliant provider
 * (Keycloak, Auth0, Okta, Azure AD, etc.)
 *
 * Configuration is loaded from:
 * 1. Environment variables (VITE_OIDC_*)
 * 2. Runtime config file (/config.json) - optional override
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { WebStorageStateStore, type UserManagerSettings } from 'oidc-client-ts';

/**
 * Runtime configuration loaded from /config.json
 */
interface RuntimeConfig {
  oidc?: {
    authority?: string;
    clientId?: string;
    scope?: string;
  };
}

// Cached runtime config
let runtimeConfig: RuntimeConfig | null = null;

/**
 * Fetches runtime configuration from /config.json
 * Returns null if file doesn't exist or fails to load
 */
async function fetchRuntimeConfig(): Promise<RuntimeConfig | null> {
  if (runtimeConfig !== null) {
    return runtimeConfig;
  }

  try {
    const response = await fetch('/config.json');
    if (response.ok) {
      runtimeConfig = await response.json();
      return runtimeConfig;
    }
  } catch {
    // Ignore errors - runtime config is optional
  }

  runtimeConfig = {};
  return runtimeConfig;
}

/**
 * Checks if OIDC is enabled (synchronous, build-time only)
 * OIDC is enabled when VITE_OIDC_AUTHORITY is set at build time
 * @deprecated Use isOIDCEnabledAsync for runtime config support
 */
export function isOIDCEnabled(): boolean {
  return !!import.meta.env.VITE_OIDC_AUTHORITY;
}

/**
 * Checks if OIDC is enabled (async, supports runtime config)
 * OIDC is enabled when authority is set via env var OR runtime config
 */
export async function isOIDCEnabledAsync(): Promise<boolean> {
  // First check build-time env var
  if (import.meta.env.VITE_OIDC_AUTHORITY) {
    return true;
  }
  // Then check runtime config
  const runtime = await fetchRuntimeConfig();
  return !!runtime?.oidc?.authority;
}

/**
 * OIDC login needs a secure context: oidc-client-ts generates the PKCE challenge with
 * `crypto.subtle`, which browsers only expose on HTTPS or `http://localhost`.
 */
export function isSecureContextForOIDC(): boolean {
  return window.isSecureContext && !!globalThis.crypto?.subtle;
}

/**
 * Gets the OIDC authority URL
 * Priority: runtime config > environment variable
 */
export async function getAuthority(): Promise<string> {
  const runtime = await fetchRuntimeConfig();
  return runtime?.oidc?.authority || import.meta.env.VITE_OIDC_AUTHORITY || '';
}

/**
 * Gets the OIDC client ID
 * Priority: runtime config > environment variable
 */
export async function getClientId(): Promise<string> {
  const runtime = await fetchRuntimeConfig();
  return runtime?.oidc?.clientId || import.meta.env.VITE_OIDC_CLIENT_ID || '';
}

/**
 * Gets the OIDC scope
 * Priority: runtime config > environment variable > default
 */
export async function getScope(): Promise<string> {
  const runtime = await fetchRuntimeConfig();
  return (
    runtime?.oidc?.scope ||
    import.meta.env.VITE_OIDC_SCOPE ||
    'openid profile email'
  );
}

/**
 * Builds the UserManager settings for oidc-client-ts
 */
export async function buildOIDCSettings(): Promise<UserManagerSettings> {
  const authority = await getAuthority();
  const clientId = await getClientId();
  const scope = await getScope();

  if (!authority || !clientId) {
    throw new Error(
      'OIDC configuration missing. Set VITE_OIDC_AUTHORITY and VITE_OIDC_CLIENT_ID environment variables.'
    );
  }

  const origin = window.location.origin;

  return {
    authority,
    client_id: clientId,
    redirect_uri: `${origin}/callback`,
    post_logout_redirect_uri: `${origin}/`,
    scope,

    // Keep the session in localStorage (library default is sessionStorage) so it is shared
    // across tabs and survives a browser restart, like the previous login flow.
    userStore: new WebStorageStateStore({ store: window.localStorage }),

    // Use authorization code flow with PKCE (recommended for SPAs)
    response_type: 'code',

    // Silent renewal configuration
    automaticSilentRenew: true,
    silent_redirect_uri: `${origin}/silent-renew.html`,

    // Refresh token 60 seconds before expiry
    accessTokenExpiringNotificationTimeInSeconds: 60,

    // Include ID token claims in user profile
    loadUserInfo: true,
  };
}
