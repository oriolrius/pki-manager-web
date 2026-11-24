import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { TRPCError } from '@trpc/server';

vi.mock('../lib/oidc.js', () => ({ isOIDCEnabled: () => true }));

const { router, publicProcedure, protectedProcedure } = await import('./init.js');

const testRouter = router({
  secure: protectedProcedure.query(() => 'ok'),
  boom: publicProcedure.query(() => {
    throw new Error('internal failure at /app/backend/src/services/x.ts');
  }),
  bad: publicProcedure.query(() => {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'bad' });
  }),
});

async function call(path: string) {
  const app = Fastify({ logger: false });
  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: testRouter,
      createContext: () => ({ req: { headers: {} }, res: {}, db: {}, user: undefined }) as never,
    },
  });
  const res = await app.inject({ method: 'GET', url: `/trpc/${path}` });
  await app.close();
  return { status: res.statusCode, body: res.body, json: res.json() };
}

const original = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = original;
});

describe('tRPC error responses', () => {
  for (const path of ['secure', 'boom', 'bad']) {
    it(`production: ${path} carries no stack or file paths`, async () => {
      process.env.NODE_ENV = 'production';
      const { json, body } = await call(path);
      expect(json.error.data.stack).toBeUndefined();
      expect(body).not.toMatch(/\/app\//);
      expect(body).not.toMatch(/\bsrc\//);
      expect(body).not.toMatch(/\.(ts|js):\d+/);
    });
  }

  it('production: unauthenticated call is 401', async () => {
    process.env.NODE_ENV = 'production';
    expect((await call('secure')).status).toBe(401);
  });

  it('development: stack is allowed', async () => {
    process.env.NODE_ENV = 'development';
    const { json } = await call('boom');
    expect(typeof json.error.data.stack).toBe('string');
  });
});
