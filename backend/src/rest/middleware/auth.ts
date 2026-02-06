/**
 * REST API Authentication Middleware
 *
 * Fastify preHandler hook for JWT validation on REST API endpoints.
 * Uses the shared JWT validation module.
 */

import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { validateAuthHeader, JWTValidationError, type AuthUser } from '../../lib/jwt.js';
import { isOIDCEnabled } from '../../lib/oidc.js';
import { logger } from '../../lib/logger.js';

/**
 * Extend Fastify request to include authenticated user
 */
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * REST API authentication preHandler hook
 *
 * Validates JWT token from Authorization header and attaches user to request.
 * Returns 401 Unauthorized for invalid or missing tokens.
 */
export const authPreHandler: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  // Skip auth if OIDC is disabled
  if (!isOIDCEnabled()) {
    logger.debug('OIDC disabled, skipping REST API authentication');
    return;
  }

  try {
    const user = await validateAuthHeader(request.headers.authorization);
    request.user = user;
  } catch (error) {
    if (error instanceof JWTValidationError) {
      logger.debug({ code: error.code, message: error.message }, 'REST API auth failed');

      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: error.message,
        },
      });
    }

    // Unexpected error
    logger.error({ error }, 'Unexpected error during REST API authentication');
    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication failed',
      },
    });
  }
};

/**
 * Performs JWT authentication on a request
 */
async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  // Skip auth if OIDC is disabled
  if (!isOIDCEnabled()) {
    logger.debug('OIDC disabled, skipping REST API authentication');
    return true;
  }

  try {
    const user = await validateAuthHeader(request.headers.authorization);
    request.user = user;
    return true;
  } catch (error) {
    if (error instanceof JWTValidationError) {
      logger.debug({ code: error.code, message: error.message }, 'REST API auth failed');

      reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: error.message,
        },
      });
      return false;
    }

    // Unexpected error
    logger.error({ error }, 'Unexpected error during REST API authentication');
    reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication failed',
      },
    });
    return false;
  }
}

/**
 * Creates a preHandler that skips authentication for specified routes
 *
 * @param publicPaths - Array of path patterns that should skip authentication
 * @returns preHandler hook that conditionally applies authentication
 */
export function createAuthPreHandler(
  publicPaths: string[] = []
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Check if this path should skip authentication
    const url = request.url.split('?')[0]; // Remove query string

    for (const pattern of publicPaths) {
      // Simple pattern matching - supports exact match and prefix match with *
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (url.startsWith(prefix)) {
          logger.debug({ url, pattern }, 'Skipping auth for public path');
          return;
        }
      } else if (url === pattern) {
        logger.debug({ url, pattern }, 'Skipping auth for public path');
        return;
      }
    }

    // Apply authentication
    await authenticateRequest(request, reply);
  };
}
