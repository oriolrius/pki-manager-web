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
import { setAuditActor, userActor, ANONYMOUS_ACTOR } from '../../lib/audit-actor.js';
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
export async function authMiddlewareHandler<Result>({
  ctx,
  next,
}: {
  ctx: Context;
  next: (opts?: { ctx: AuthenticatedContext }) => Promise<Result>;
}) {
  // Skip auth if OIDC is not enabled
  if (!isOIDCEnabled()) {
    logger.debug('OIDC disabled, skipping tRPC authentication');
    setAuditActor(ANONYMOUS_ACTOR);
    return next();
  }

  try {
    // Validate token and extract user using shared JWT module
    const user = await validateAuthHeader(ctx.req.headers.authorization);

    setAuditActor(userActor(user));

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
 * Creates a role-checking middleware
 *
 * @param requiredRoles - Roles required to access the procedure (any match)
 * @returns Middleware function that checks for required roles
 */
type RoleMiddlewareFn = (opts: {
  ctx: AuthenticatedContext;
  next: () => Promise<unknown>;
}) => Promise<unknown>;

export function createRoleMiddleware<T extends { middleware: (fn: RoleMiddlewareFn) => unknown }>(
  t: T,
  requiredRoles: string[]
) {
  return t.middleware(
    async ({ ctx, next }: Parameters<RoleMiddlewareFn>[0]) => {
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
