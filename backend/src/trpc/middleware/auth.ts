/**
 * Authentication Middleware for tRPC
 *
 * Validates JWT tokens from Authorization header using JWKS.
 * Extracts user info and roles from token claims.
 *
 * Reference: decision-009 - OIDC Authentication Implementation
 */

import { TRPCError } from '@trpc/server';
import {
  validateAuthHeader,
  JWTValidationError,
  type AuthUser,
} from '../../lib/jwt.js';
import { isOIDCEnabled } from '../../lib/oidc.js';
import { logger } from '../../lib/logger.js';
import type { Context } from '../context.js';

// Re-export AuthUser for backward compatibility
export type { AuthUser } from '../../lib/jwt.js';

/**
 * Context with authenticated user
 */
export interface AuthenticatedContext extends Context {
  user: AuthUser;
}

/**
 * Converts JWTValidationError to TRPCError
 */
function toTRPCError(error: JWTValidationError): TRPCError {
  return new TRPCError({
    code: error.code === 'OIDC_DISABLED' ? 'INTERNAL_SERVER_ERROR' : 'UNAUTHORIZED',
    message: error.message,
  });
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

  try {
    // Validate token and extract user using shared JWT module
    const user = await validateAuthHeader(ctx.req.headers.authorization);

    // Add user to context and continue
    return next({
      ctx: {
        ...ctx,
        user,
      },
    });
  } catch (error) {
    if (error instanceof JWTValidationError) {
      throw toTRPCError(error);
    }
    throw error;
  }
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
