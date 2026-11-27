import { initTRPC, TRPCError } from '@trpc/server';
import type { OpenApiMeta } from 'trpc-to-openapi';
import type { Context, AuthenticatedContext } from './context.js';
import { authMiddlewareHandler } from './middleware/auth.js';
import { isOIDCEnabled } from '../lib/oidc.js';
import { logger } from '../lib/logger.js';
import { KeyStoreTrpcCause, throwIfKeyStoreError } from './key-store-errors.js';

/**
 * Strip server internals (stack trace) from a tRPC error shape. Evaluated per
 * error (not once at import) and fail-safe: only an explicit development/test
 * NODE_ENV keeps stacks; anything else (production, unset) removes them.
 */
function stripInternals<S extends { data?: unknown }>(shape: S, error: TRPCError): S {
  const keepStack = ['development', 'test'].includes(process.env.NODE_ENV ?? '');
  if (keepStack || !shape.data || typeof shape.data !== 'object') return shape;
  const { stack: _stack, ...data } = shape.data as Record<string, unknown>;
  // An unexpected exception (tRPC wrapped a raw Error, copying its message) may embed file paths
  // or DB details: replace its message. A TRPCError thrown on purpose keeps its message.
  const cause = error.cause;
  const internal = (shape as { code?: number }).code === -32603
    && cause instanceof Error && !(cause instanceof TRPCError) && error.message === cause.message;
  return { ...shape, ...(internal ? { message: 'Internal server error' } : {}), data };
}

const t = initTRPC.context<Context>().meta<OpenApiMeta>().create({
  // Stacks are always generated; stripInternals() decides per error whether they leave the process.
  isDev: true,
  errorFormatter({ shape, error }) {
    return stripInternals({
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.code === 'BAD_REQUEST' && error.cause
            ? error.cause
            : null,
        // Stable application code of a key store error (KEY_STORE_UNAVAILABLE, KEY_MIGRATION_REQUIRED, ...).
        ...(error.cause instanceof KeyStoreTrpcCause ? { appCode: error.cause.appCode } : {}),
      },
    }, error);
  },
});

export const router = t.router;

/**
 * Every procedure: a key store error that a procedure lets through (raw, or as the `cause` of
 * its own error) leaves as 503 / 409 / 403 instead of a generic 500 (`key-store-errors.ts`).
 */
const keyStoreErrorMiddleware = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) throwIfKeyStoreError(result.error);
  return result;
});
const baseProcedure = t.procedure.use(keyStoreErrorMiddleware);

export const publicProcedure = baseProcedure;

// Logging middleware
const loggingMiddleware = t.middleware(async ({ path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const durationMs = Date.now() - start;

  console.log(`${type} ${path} - ${durationMs}ms`);

  return result;
});

// Public procedure with logging
export const loggedProcedure = baseProcedure.use(loggingMiddleware);

/**
 * Authentication middleware - validates JWT and adds user to context
 */
const authMiddleware = t.middleware(authMiddlewareHandler);

/**
 * Protected procedure - requires valid JWT token
 *
 * Use this for procedures that require authentication.
 * The context will have a `user` object with sub, email, name, and roles.
 *
 * @example
 * ```ts
 * export const myProcedure = protectedProcedure
 *   .query(({ ctx }) => {
 *     // ctx.user is guaranteed to exist
 *     return { userId: ctx.user.sub };
 *   });
 * ```
 */
export const protectedProcedure = baseProcedure.use(authMiddleware);

/**
 * Admin role middleware - requires 'admin' role
 */
const adminRoleMiddleware = t.middleware(async ({ ctx, next }) => {
  logger.info('[AdminMiddleware] Middleware entered');

  // Skip role check if OIDC is disabled
  if (!isOIDCEnabled()) {
    logger.info('[AdminMiddleware] OIDC is disabled, skipping role check');
    return next();
  }

  // Type assertion since this middleware runs after authMiddleware
  const authenticatedCtx = ctx as AuthenticatedContext;

  logger.info(
    {
      sub: authenticatedCtx.user?.sub,
      roles: authenticatedCtx.user?.roles,
      hasAdmin: authenticatedCtx.user?.roles?.includes('admin'),
    },
    '[AdminMiddleware] Checking admin role for user'
  );

  if (!authenticatedCtx.user.roles.includes('admin')) {
    logger.info('[AdminMiddleware] FORBIDDEN - User does not have admin role');
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin role required',
    });
  }

  logger.info('[AdminMiddleware] Admin role verified');
  return next();
});

/**
 * Admin procedure - requires valid JWT token with 'admin' role
 *
 * Use this for procedures that require admin privileges.
 * The context will have a `user` object with sub, email, name, and roles.
 *
 * @example
 * ```ts
 * export const adminOnlyProcedure = adminProcedure
 *   .mutation(({ ctx }) => {
 *     // ctx.user is guaranteed to exist and have 'admin' role
 *     return { admin: ctx.user.sub };
 *   });
 * ```
 */
export const adminProcedure = protectedProcedure.use(adminRoleMiddleware);

/**
 * Fail-closed guard for SSH CA management + signing (SSH-34). When OIDC is
 * disabled the admin role check is vacuous (adminRoleMiddleware returns next()),
 * so an unauthenticated caller could forge CAs. This refuses SSH CA/issuance
 * operations unless OIDC is enabled OR an explicit local-dev opt-in is set.
 */
const sshFailClosedMiddleware = t.middleware(async ({ next }) => {
  if (!isOIDCEnabled() && process.env.ALLOW_UNAUTHENTICATED_SSH_CA !== 'true') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        'SSH CA management and certificate signing require OIDC. Enable OIDC, or set ALLOW_UNAUTHENTICATED_SSH_CA=true for local dev only.',
    });
  }
  return next();
});

/** Admin procedure for SSH CA/signing — admin role AND fail-closed when OIDC is off. */
export const sshAdminProcedure = adminProcedure.use(sshFailClosedMiddleware);

/** Protected procedure for SSH issuance/reads with the same fail-closed posture. */
export const sshProtectedProcedure = protectedProcedure.use(sshFailClosedMiddleware);
