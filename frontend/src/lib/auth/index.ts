/**
 * Authentication Module
 *
 * Provides OIDC authentication for the frontend using react-oidc-context.
 * Works with any OIDC-compliant provider (Keycloak, Auth0, Okta, Azure AD, etc.)
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

// Re-export AuthProvider component
export { AuthProvider } from './AuthProvider';

// Re-export configuration utilities
export { isOIDCEnabled, getAuthority, getClientId, getScope } from './config';

// Re-export token utilities for tRPC client
export { getAccessToken, getUser } from './token';

// Re-export useAuth hook from react-oidc-context
export { useAuth } from 'react-oidc-context';

// Re-export types
export type { User } from 'oidc-client-ts';
