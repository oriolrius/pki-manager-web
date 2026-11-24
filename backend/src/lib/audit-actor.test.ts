import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { desc } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { createAuditLog } from './audit.js';
import { installAuditActorContext } from './audit-actor.js';

const state = vi.hoisted(() => ({ oidc: false }));

vi.mock('./oidc.js', async (original) => ({
  ...(await original<typeof import('./oidc.js')>()),
  isOIDCEnabled: () => state.oidc,
}));
vi.mock('./jwt.js', async (original) => ({
  ...(await original<typeof import('./jwt.js')>()),
  validateAuthHeader: async () => ({
    sub: 'sub-123',
    email: 'alice@example.test',
    preferredUsername: 'alice',
    roles: [],
    rawPayload: {},
  }),
}));
vi.mock('../db/client.js', () => ({ db: {} }));
vi.mock('../services/integration.service.js', () => ({
  getIntegrationService: () => ({
    verifyToken: async () => ({ id: 'int-1', name: 'k8s-prod', caId: 'ca', kind: 'kubernetes' }),
  }),
}));

const { authPreHandler } = await import('../rest/middleware/auth.js');
const { integrationAuthPreHandler } = await import('../rest/middleware/integration-auth.js');
const { authMiddlewareHandler } = await import('../trpc/middleware/auth.js');

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let app: FastifyInstance;

const lastRow = () => db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.timestamp)).limit(1).all()[0];
const audit = () => createAuditLog({ db, operation: 'ca.list', entityType: 'ca', status: 'success' });

beforeEach(async () => {
  state.oidc = false;
  sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) });

  app = Fastify({ logger: false });
  installAuditActorContext(app);
  app.get('/rest', { preHandler: authPreHandler }, async () => {
    await audit();
    return { ok: true };
  });
  app.get('/external', { preHandler: integrationAuthPreHandler }, async () => {
    await audit();
    return { ok: true };
  });
  app.get('/trpc-like', async (req) => {
    await authMiddlewareHandler({
      ctx: { req, headers: req.headers } as any,
      next: async () => {
        await audit();
        return {};
      },
    });
    return { ok: true };
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

describe('audit actor capture (issue #27)', () => {
  it('records the OIDC subject and preferred_username on REST', async () => {
    state.oidc = true;
    await app.inject({ method: 'GET', url: '/rest', headers: { authorization: 'Bearer x' } });
    expect(lastRow()).toMatchObject({ actorType: 'user', actorId: 'sub-123', actorName: 'alice' });
  });

  it('records the OIDC user on tRPC', async () => {
    state.oidc = true;
    await app.inject({ method: 'GET', url: '/trpc-like', headers: { authorization: 'Bearer x' } });
    expect(lastRow()).toMatchObject({ actorType: 'user', actorId: 'sub-123', actorName: 'alice' });
  });

  it('records the integration id and name for service tokens', async () => {
    await app.inject({ method: 'GET', url: '/external', headers: { authorization: 'Bearer pkimg_x' } });
    expect(lastRow()).toMatchObject({ actorType: 'integration', actorId: 'int-1', actorName: 'k8s-prod' });
  });

  it('records "anonymous" when OIDC is off', async () => {
    await app.inject({ method: 'GET', url: '/rest' });
    expect(lastRow()).toMatchObject({ actorType: 'anonymous', actorId: null, actorName: 'anonymous' });
    await app.inject({ method: 'GET', url: '/trpc-like' });
    expect(lastRow()).toMatchObject({ actorType: 'anonymous', actorName: 'anonymous' });
  });

  it('does not leak the actor between concurrent requests', async () => {
    state.oidc = true;
    await Promise.all([
      app.inject({ method: 'GET', url: '/rest', headers: { authorization: 'Bearer x' } }),
      app.inject({ method: 'GET', url: '/external', headers: { authorization: 'Bearer pkimg_x' } }),
    ]);
    const types = db.select().from(schema.auditLog).all().map((r) => r.actorType).sort();
    expect(types).toEqual(['integration', 'user']);
  });

  it('leaves the actor null outside a request (system / legacy rows)', async () => {
    await audit();
    expect(lastRow()).toMatchObject({ actorType: null, actorId: null, actorName: null });
  });
});
