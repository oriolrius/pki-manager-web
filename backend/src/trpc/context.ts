import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { db } from '../db/client.js';

/**
 * Authenticated user information from JWT token
 * Available in context when using protectedProcedure or adminProcedure
 */
export interface ContextUser {
  /** Subject identifier (unique user ID from IdP) */
  sub: string;

  /** User's email address (if available) */
  email?: string;

  /** User's display name (if available) */
  name?: string;

  /** Roles extracted from token claims */
  roles: string[];
}

// Narrowed to the two options we actually use: tRPC v11 added a required `info`
// field to CreateFastifyContextOptions that tests don't (and shouldn't) fabricate.
// Contravariance keeps this assignable where the fastify plugin expects the full type.
export async function createContext({ req, res }: Pick<CreateFastifyContextOptions, 'req' | 'res'>) {
  return {
    req,
    res,
    db,
    /** User info from JWT - populated by auth middleware for protected routes */
    user: undefined as ContextUser | undefined,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

/**
 * Context type with authenticated user (for protected/admin procedures)
 */
export type AuthenticatedContext = Omit<Context, 'user'> & {
  user: ContextUser;
};
