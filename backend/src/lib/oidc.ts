/**
 * OIDC Configuration Module
 *
 * Provider-agnostic OIDC configuration that works with any compliant provider
 * (Keycloak, Auth0, Okta, Azure AD, etc.)
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { logger } from './logger.js';

/**
 * OIDC Configuration
 */
export interface OIDCConfig {
  /** OIDC Issuer URL (e.g., http://localhost:42997/realms/pki-dev) */
  issuer: string;

  /** Expected audience claims (client_ids that are allowed to access the API) */
  audiences: string[];

  /** Path to roles claim in JWT payload (e.g., "realm_access.roles" for Keycloak) */
  rolesClaimPath: string;

  /** JWKS URI (derived from discovery or constructed from issuer) */
  jwksUri: string;

  /** Whether OIDC is enabled */
  enabled: boolean;
}

/**
 * OIDC Discovery Document (subset of fields we use)
 */
interface OIDCDiscoveryDocument {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint?: string;
}

// Cached configuration and JWKS
let cachedConfig: OIDCConfig | null = null;
let cachedJWKS: JWTVerifyGetKey | null = null;

/**
 * Validates that required environment variables are set
 * @throws Error if required variables are missing when OIDC is enabled
 */
function validateEnvironment(): { isEnabled: boolean; errors: string[] } {
  const errors: string[] = [];

  const issuer = process.env.OIDC_ISSUER;
  const audience = process.env.OIDC_AUDIENCE;

  // If neither is set, OIDC is disabled
  if (!issuer && !audience) {
    return { isEnabled: false, errors: [] };
  }

  // If one is set but not the other, that's an error
  if (!issuer) {
    errors.push('OIDC_ISSUER environment variable is required when OIDC is enabled');
  }
  if (!audience) {
    errors.push('OIDC_AUDIENCE environment variable is required when OIDC is enabled');
  }

  return { isEnabled: errors.length === 0, errors };
}

/**
 * Parses the OIDC_AUDIENCE environment variable into an array of audiences
 * Supports comma-separated values: "pki-web,pki-service"
 */
function parseAudiences(audienceEnv: string): string[] {
  return audienceEnv
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

/**
 * Fetches OIDC discovery document from the issuer
 */
async function fetchDiscoveryDocument(issuer: string): Promise<OIDCDiscoveryDocument> {
  const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;

  logger.debug({ discoveryUrl }, 'Fetching OIDC discovery document');

  const response = await fetch(discoveryUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch OIDC discovery document from ${discoveryUrl}: ${response.status} ${response.statusText}`
    );
  }

  const document = (await response.json()) as OIDCDiscoveryDocument;

  // Validate required fields
  if (!document.issuer) {
    throw new Error('OIDC discovery document missing required field: issuer');
  }
  if (!document.jwks_uri) {
    throw new Error('OIDC discovery document missing required field: jwks_uri');
  }

  return document;
}

/**
 * Initializes OIDC configuration from environment variables
 * Uses OIDC discovery to get JWKS URI
 *
 * @throws Error if configuration is invalid or discovery fails
 */
export async function initializeOIDC(): Promise<OIDCConfig> {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig;
  }

  const { isEnabled, errors } = validateEnvironment();

  if (errors.length > 0) {
    throw new Error(`OIDC configuration errors:\n${errors.join('\n')}`);
  }

  if (!isEnabled) {
    logger.info('OIDC authentication is disabled (OIDC_ISSUER not set)');
    cachedConfig = {
      issuer: '',
      audiences: [],
      rolesClaimPath: '',
      jwksUri: '',
      enabled: false,
    };
    return cachedConfig;
  }

  const issuer = process.env.OIDC_ISSUER!;
  const audiences = parseAudiences(process.env.OIDC_AUDIENCE!);
  const rolesClaimPath = process.env.OIDC_ROLES_CLAIM || 'realm_access.roles';

  logger.info({ issuer, audiences, rolesClaimPath }, 'Initializing OIDC configuration');

  // Fetch discovery document to get JWKS URI
  const discovery = await fetchDiscoveryDocument(issuer);

  // Validate issuer matches
  if (discovery.issuer !== issuer) {
    logger.warn(
      { expected: issuer, actual: discovery.issuer },
      'OIDC issuer mismatch - using discovered issuer'
    );
  }

  cachedConfig = {
    issuer: discovery.issuer,
    audiences,
    rolesClaimPath,
    jwksUri: discovery.jwks_uri,
    enabled: true,
  };

  logger.info(
    { issuer: cachedConfig.issuer, jwksUri: cachedConfig.jwksUri },
    'OIDC configuration initialized successfully'
  );

  return cachedConfig;
}

/**
 * Gets the current OIDC configuration
 * Must call initializeOIDC() first
 *
 * @throws Error if not initialized
 */
export function getOIDCConfig(): OIDCConfig {
  if (!cachedConfig) {
    throw new Error('OIDC not initialized. Call initializeOIDC() first.');
  }
  return cachedConfig;
}

/**
 * Gets or creates the JWKS client for JWT verification
 * Uses jose's createRemoteJWKSet which handles caching and key rotation
 *
 * @throws Error if OIDC is not enabled or not initialized
 */
export function getJWKS(): JWTVerifyGetKey {
  const config = getOIDCConfig();

  if (!config.enabled) {
    throw new Error('OIDC is not enabled');
  }

  if (!cachedJWKS) {
    logger.debug({ jwksUri: config.jwksUri }, 'Creating JWKS client');
    cachedJWKS = createRemoteJWKSet(new URL(config.jwksUri));
  }

  return cachedJWKS;
}

/**
 * Extracts roles from JWT payload using the configured claim path
 *
 * @param payload - JWT payload object
 * @returns Array of role strings
 *
 * @example
 * // For Keycloak with rolesClaimPath = "realm_access.roles"
 * // payload = { realm_access: { roles: ["admin", "user"] } }
 * extractRoles(payload) // returns ["admin", "user"]
 *
 * @example
 * // For Auth0 with rolesClaimPath = "permissions"
 * // payload = { permissions: ["read:certs", "write:certs"] }
 * extractRoles(payload) // returns ["read:certs", "write:certs"]
 */
export function extractRoles(payload: Record<string, unknown>): string[] {
  const config = getOIDCConfig();

  if (!config.enabled || !config.rolesClaimPath) {
    return [];
  }

  const parts = config.rolesClaimPath.split('.');
  let value: unknown = payload;

  for (const part of parts) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return [];
    }
    value = (value as Record<string, unknown>)[part];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return [];
}

/**
 * Checks if OIDC is enabled
 */
export function isOIDCEnabled(): boolean {
  return cachedConfig?.enabled ?? false;
}

/**
 * Resets the OIDC configuration (useful for testing)
 */
export function resetOIDCConfig(): void {
  cachedConfig = null;
  cachedJWKS = null;
}
