import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { db } from '../db/client.js';

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  return {
    req,
    res,
    db,
    // KMS client will be added in task-005
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
