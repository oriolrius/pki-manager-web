/**
 * JWT Validation Module
 *
 * Shared JWT token validation logic used by both tRPC and REST API.
 * Validates tokens against OIDC provider's JWKS.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { jwtVerify, type JWTPayload } from 'jose';
import {
  getOIDCConfig,
  getJWKS,
  extractRoles,
  isOIDCEnabled,
} from './oidc.js';
import { logger } from './logger.js';

/**
 * Authenticated user information extracted from JWT
 */
export interface AuthUser {
  /** Subject identifier (unique user ID from IdP) */
  sub: string;

  /** User's email address (if available) */
  email?: string;

  /** User's display name (if available) */
  name?: string;

  /** User's preferred username (if available) */
  preferredUsername?: string;

  /** Roles extracted from token claims */
  roles: string[];

  /** Raw JWT payload for advanced use cases */
  rawPayload: JWTPayload;
}

/**
 * JWT validation error with specific error code
 */
export class JWTValidationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'MISSING_TOKEN'
      | 'INVALID_FORMAT'
      | 'EXPIRED'
      | 'ISSUER_MISMATCH'
      | 'AUDIENCE_MISMATCH'
      | 'SIGNATURE_INVALID'
      | 'MISSING_SUBJECT'
      | 'OIDC_DISABLED'
      | 'INVALID_TOKEN'
  ) {
    super(message);
    this.name = 'JWTValidationError';
  }
}

/**
 * Extracts Bearer token from Authorization header
 *
 * @param authHeader - The Authorization header value
 * @returns The token or null if not a valid Bearer token
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Validates a JWT token and extracts user information
 *
 * @param token - The JWT token to validate
 * @returns The authenticated user information
 * @throws JWTValidationError if token is invalid
 */
export async function validateToken(token: string): Promise<AuthUser> {
  if (!isOIDCEnabled()) {
    throw new JWTValidationError(
      'Authentication is not configured',
      'OIDC_DISABLED'
    );
  }

  const config = getOIDCConfig();
  const JWKS = getJWKS();

  try {
    // First verify without audience check (Keycloak doesn't always include aud)
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: config.issuer,
    });

    // Manually check audience/azp - Keycloak uses azp instead of aud for OAuth2 clients
    const tokenAudience = payload.aud;
    const tokenAzp = payload.azp as string | undefined;

    // Check if audience matches any of the allowed audiences (aud can be string or array)
    let audienceValid = false;
    if (tokenAudience) {
      if (Array.isArray(tokenAudience)) {
        audienceValid = tokenAudience.some((aud) => config.audiences.includes(aud));
      } else {
        audienceValid = config.audiences.includes(tokenAudience);
      }
    }

    // Fall back to checking azp (authorized party) - common in Keycloak
    if (!audienceValid && tokenAzp) {
      audienceValid = config.audiences.includes(tokenAzp);
    }

    if (!audienceValid) {
      logger.debug(
        { aud: tokenAudience, azp: tokenAzp, expected: config.audiences },
        'Token audience/azp mismatch'
      );
      throw new JWTValidationError(
        'Token not intended for this audience',
        'AUDIENCE_MISMATCH'
      );
    }

    // Extract user identifier
    // Prefer 'sub' claim, but fall back to 'preferred_username' or session ID
    let sub = payload.sub;
    if (!sub) {
      // Try preferred_username as fallback (common in Keycloak)
      const preferredUsername = payload.preferred_username as string | undefined;
      if (preferredUsername) {
        sub = preferredUsername;
        logger.debug(
          { preferredUsername },
          'Using preferred_username as user identifier (no sub claim)'
        );
      } else {
        // Last resort: use session ID if available
        const sid = payload.sid as string | undefined;
        if (sid) {
          sub = sid;
          logger.debug(
            { sid },
            'Using session ID as user identifier (no sub or preferred_username)'
          );
        } else {
          throw new JWTValidationError(
            'Token missing user identifier',
            'MISSING_SUBJECT'
          );
        }
      }
    }

    // Extract optional claims
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    const name = typeof payload.name === 'string' ? payload.name : undefined;
    const preferredUsername =
      typeof payload.preferred_username === 'string'
        ? payload.preferred_username
        : undefined;

    // Extract roles using configurable claim path
    const roles = extractRoles(payload as Record<string, unknown>);

    logger.debug(
      { sub, email, roles: roles.length },
      'Token validated successfully'
    );

    return {
      sub,
      email,
      name,
      preferredUsername,
      roles,
      rawPayload: payload,
    };
  } catch (error) {
    // Re-throw our own errors
    if (error instanceof JWTValidationError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Log the error for debugging
    logger.debug({ error: errorMessage }, 'Token validation failed');

    // Check for specific JWT errors
    if (errorMessage.includes('exp')) {
      throw new JWTValidationError('Token has expired', 'EXPIRED');
    }

    if (errorMessage.includes('iss')) {
      throw new JWTValidationError('Token issuer mismatch', 'ISSUER_MISMATCH');
    }

    if (errorMessage.includes('aud')) {
      throw new JWTValidationError('Token audience mismatch', 'AUDIENCE_MISMATCH');
    }

    if (errorMessage.includes('signature')) {
      throw new JWTValidationError('Token signature invalid', 'SIGNATURE_INVALID');
    }

    // Generic error
    throw new JWTValidationError('Invalid token', 'INVALID_TOKEN');
  }
}

/**
 * Validates Authorization header and returns user info
 *
 * @param authHeader - The Authorization header value
 * @returns The authenticated user information
 * @throws JWTValidationError if token is missing or invalid
 */
export async function validateAuthHeader(
  authHeader: string | undefined
): Promise<AuthUser> {
  const token = extractBearerToken(authHeader);

  if (!token) {
    throw new JWTValidationError(
      'Missing or invalid Authorization header',
      'MISSING_TOKEN'
    );
  }

  return validateToken(token);
}
