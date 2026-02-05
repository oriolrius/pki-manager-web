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

import type { UserManagerSettings } from 'oidc-client-ts';

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
 * Checks if OIDC is enabled
 * OIDC is enabled when VITE_OIDC_AUTHORITY is set
 */
export function isOIDCEnabled(): boolean {
  return !!import.meta.env.VITE_OIDC_AUTHORITY;
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
    post_logout_redirect_uri: origin,
    scope,

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
