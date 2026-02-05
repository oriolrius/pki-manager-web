/**
 * Authentication Middleware for tRPC
 *
 * Validates JWT tokens from Authorization header using JWKS.
 * Extracts user info and roles from token claims.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { TRPCError } from '@trpc/server';
import { jwtVerify, type JWTPayload } from 'jose';
import {
  getOIDCConfig,
  getJWKS,
  extractRoles,
  isOIDCEnabled,
} from '../../lib/oidc.js';
import { logger } from '../../lib/logger.js';
import type { Context } from '../context.js';

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
 * Context with authenticated user
 */
export interface AuthenticatedContext extends Context {
  user: AuthUser;
}

/**
 * Extracts Bearer token from Authorization header
 *
 * @param authHeader - The Authorization header value
 * @returns The token or null if not a valid Bearer token
 */
function extractBearerToken(authHeader: string | undefined): string | null {
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
 * @throws TRPCError if token is invalid
 */
async function validateToken(token: string): Promise<AuthUser> {
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
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Token not intended for this audience',
      });
    }

    // Extract user identifier
    // Prefer 'sub' claim, but fall back to 'preferred_username' or session ID
    // Some providers (Keycloak) don't include 'sub' in access tokens by default
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
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Token missing user identifier',
          });
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
    // Handle specific JWT errors
    if (error instanceof TRPCError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Log the error for debugging
    logger.debug({ error: errorMessage }, 'Token validation failed');

    // Check for specific JWT errors
    if (errorMessage.includes('exp')) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Token has expired',
      });
    }

    if (errorMessage.includes('iss')) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Token issuer mismatch',
      });
    }

    if (errorMessage.includes('aud')) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Token audience mismatch',
      });
    }

    if (errorMessage.includes('signature')) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Token signature invalid',
      });
    }

    // Generic error
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Invalid token',
    });
  }
}

/**
 * Authentication middleware function for tRPC
 *
 * This middleware:
 * 1. Extracts Bearer token from Authorization header
 * 2. Validates JWT signature against JWKS
 * 3. Verifies issuer and audience claims
 * 4. Extracts user info and roles to context
 */
export async function authMiddlewareHandler({
  ctx,
  next,
}: {
  ctx: Context;
  next: (opts?: { ctx: AuthenticatedContext }) => Promise<any>;
}): Promise<any> {
  // Check if OIDC is enabled
  if (!isOIDCEnabled()) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Authentication is not configured',
    });
  }

  // Extract Authorization header
  const authHeader = ctx.req.headers.authorization;
  const token = extractBearerToken(authHeader);

  if (!token) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid Authorization header',
    });
  }

  // Validate token and extract user
  const user = await validateToken(token);

  // Add user to context and continue
  return next({
    ctx: {
      ...ctx,
      user,
    },
  });
}

/**
 * Creates the authentication middleware for tRPC
 *
 * @param t - The tRPC instance
 * @returns Middleware that can be used with .use()
 */
export function createAuthMiddleware<T extends { middleware: (fn: any) => any }>(
  t: T
) {
  return t.middleware(authMiddlewareHandler);
}

/**
 * Creates a role-checking middleware
 *
 * @param requiredRoles - Roles required to access the procedure (any match)
 * @returns Middleware function that checks for required roles
 */
export function createRoleMiddleware<T extends { middleware: Function }>(
  t: T,
  requiredRoles: string[]
) {
  return t.middleware(
    async ({ ctx, next }: { ctx: AuthenticatedContext; next: Function }) => {
      const userRoles = ctx.user.roles;

      // Check if user has any of the required roles
      const hasRole = requiredRoles.some((role) => userRoles.includes(role));

      if (!hasRole) {
        logger.debug(
          { required: requiredRoles, actual: userRoles },
          'Access denied - missing required role'
        );

        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Access denied. Required roles: ${requiredRoles.join(' or ')}`,
        });
      }

      return next();
    }
  );
}
