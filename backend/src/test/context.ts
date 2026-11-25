import type { FastifyRequest } from 'fastify';
import { db } from '../db/client.js';
import type { Context } from '../trpc/context.js';

/** Direct router calls only read these request fields and never send a Fastify reply. */
export function testContext(request: Partial<FastifyRequest>): Context {
  return { req: request as Context['req'], res: {} as Context['res'], db, user: undefined };
}
