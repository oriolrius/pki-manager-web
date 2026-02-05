import { initTRPC, TRPCError } from '@trpc/server';
import type { OpenApiMeta } from 'trpc-swagger';
import type { Context, AuthenticatedContext } from './context.js';
import { createAuthMiddleware } from './middleware/auth.js';

const t = initTRPC.context<Context>().meta<OpenApiMeta>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.code === 'BAD_REQUEST' && error.cause
            ? error.cause
            : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Logging middleware
const loggingMiddleware = t.middleware(async ({ path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const durationMs = Date.now() - start;

  console.log(`${type} ${path} - ${durationMs}ms`);

  return result;
});

// Public procedure with logging
export const loggedProcedure = t.procedure.use(loggingMiddleware);

/**
 * Authentication middleware - validates JWT and adds user to context
 */
const authMiddleware = createAuthMiddleware(t);

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
export const protectedProcedure = t.procedure.use(authMiddleware);

/**
 * Admin role middleware - requires 'admin' role
 */
const adminRoleMiddleware = t.middleware(async ({ ctx, next }) => {
  // Type assertion since this middleware runs after authMiddleware
  const authenticatedCtx = ctx as AuthenticatedContext;

  if (!authenticatedCtx.user.roles.includes('admin')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin role required',
    });
  }

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
