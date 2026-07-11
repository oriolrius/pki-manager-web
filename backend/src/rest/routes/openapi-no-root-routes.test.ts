/**
 * TASK-208 — the published OpenAPI doc declares a single server base of
 * `/api/v1`, but several PUBLIC routes are mounted at the server ROOT (outside
 * that prefix): the SSH trust-material / KRL downloads, the public CRL
 * distribution point, the CA-certificate download, and the tRPC catch-all.
 *
 * @fastify/swagger strips the `/api/v1` server base from the routes it captures,
 * so a genuine `/api/v1/certificates` route is documented as `/certificates`
 * (correct — it resolves back to /api/v1/certificates). But a ROOT route such as
 * `/ssh/host-ca-keys` has no `/api/v1` prefix to strip, so it was documented as
 * `/ssh/host-ca-keys`; a client resolving that against the `/api/v1` base would
 * request `/api/v1/ssh/host-ca-keys` → 404. There is no `/api/v1/ssh/host-ca-keys`
 * REST route, so the entry could never resolve.
 *
 * The fix marks each offending root route `schema: { hide: true }`, which removes
 * it from the OpenAPI document WITHOUT touching routing/validation.
 *
 * This test boots a Fastify app the way production does (openapi + the real
 * public route modules + the real tRPC adapter behind server.ts's onRoute-hide
 * wrapper, plus a stand-in for the inline server.ts /cas handler that mirrors the
 * exact `{ schema: { hide: true } }` used there) and asserts the offending root
 * paths are ABSENT from the spec while the routes STILL FUNCTION. It deliberately
 * does NOT register the authenticated `/api/v1/*` REST plugins, so the only way a
 * `/ssh`, `/krl`, `/crl`, `/cas`, or `/trpc` path could appear here is a root
 * route leaking.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initTRPC } from '@trpc/server';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { registerOpenAPI } from '../openapi.js';
import { registerSshPublicRoutes } from './ssh-public.routes.js';
import { publicCrlRoutes } from './public-crl.routes.js';
import { db } from '../../db/client.js';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

describe('TASK-208 — root-mounted public routes are hidden from the /api/v1 OpenAPI doc', () => {
  let app: FastifyInstance;
  let spec: Record<string, any>;
  let paths: Record<string, unknown>;
  let keys: string[];

  beforeAll(async () => {
    // Isolated DATABASE_PATH is supplied by the runner; migrate it so the SSH
    // trust-anchor handler can run cleanly (returns empty, no KMS needed).
    migrate(db, { migrationsFolder });

    app = Fastify();
    await registerOpenAPI(app);

    // Real production route modules — both mounted at ROOT in server.ts.
    registerSshPublicRoutes(app);
    await app.register(publicCrlRoutes);

    // Stand-in for the inline server.ts root handler — same options object
    // (`{ schema: { hide: true } }`) the production code now uses.
    app.get('/cas/:caId.:format', { schema: { hide: true } }, async () => ({ ok: true }));

    // Real tRPC adapter behind the SAME encapsulated onRoute-hide wrapper as
    // server.ts, proving the mechanism removes `/trpc/{path}` from the spec.
    const t = initTRPC.create();
    const testRouter = t.router({ ping: t.procedure.query(() => 'pong') });
    await app.register(async (trpcScope) => {
      trpcScope.addHook('onRoute', (routeOptions) => {
        routeOptions.schema = { ...routeOptions.schema, hide: true };
      });
      await trpcScope.register(fastifyTRPCPlugin, {
        prefix: '/trpc',
        trpcOptions: { router: testRouter },
      });
    });

    // Positive control: a genuine /api/v1 route. @fastify/swagger strips the
    // /api/v1 server base, so it is documented as `/certificates` — proving the
    // doc still generates and that ONLY the root routes were excluded.
    app.get(
      '/api/v1/certificates',
      { schema: { response: { 200: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
      async () => ({ ok: true })
    );

    await app.ready();
    spec = app.swagger() as Record<string, any>;
    paths = spec.paths as Record<string, unknown>;
    keys = Object.keys(paths);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('the spec advertises the /api/v1 server base and still generates paths', () => {
    expect(spec.servers).toEqual([{ url: '/api/v1', description: 'REST API v1' }]);
    // The one legitimate route we registered must be present (base stripped) —
    // proves hiding did not empty the whole document.
    expect(paths).toHaveProperty('/certificates');
  });

  it('does NOT advertise the public SSH trust-material / KRL root routes', () => {
    for (const p of [
      '/ssh/host-ca-keys',
      '/ssh/trusted-user-ca-keys',
      '/ssh/cert-authority',
      '/ssh/cas/{id}/ca.pub',
      '/ssh/hosts/{id}/cert.pub',
      '/ssh/hosts/{id}/sshd-config',
      '/krl/{caId}.bin',
      '/krl/{caId}.json',
      '/krl/hosts/{hostId}.bin',
      '/krl/hosts/{hostId}.json',
    ]) {
      expect(paths, `spec must not advertise ${p}`).not.toHaveProperty(p);
    }
  });

  it('does NOT advertise the public CRL distribution route', () => {
    expect(paths).not.toHaveProperty('/crl/{caId}.{format}');
  });

  it('does NOT advertise the CA-download or tRPC root routes', () => {
    expect(paths).not.toHaveProperty('/cas/{caId}.{format}');
    expect(paths).not.toHaveProperty('/trpc/{path}');
  });

  it('no path is advertised under any root download prefix', () => {
    // Format-agnostic backstop: this app registers ONLY root download routes
    // under these prefixes (no /api/v1/ssh|cas REST plugins), so after the fix
    // nothing may appear under them, whatever bracket style swagger uses.
    for (const prefix of ['/ssh/', '/krl/', '/crl/', '/cas/', '/trpc']) {
      const leaked = keys.filter((k) => k.startsWith(prefix));
      expect(leaked, `no root route may be advertised under ${prefix}`).toEqual([]);
    }
  });

  // ── Sanity: `hide: true` only affects the doc, the routes still function ──

  it('a hidden SSH route is still MATCHED and served (not a missing-route 404)', async () => {
    const res = await app.inject({ method: 'GET', url: '/ssh/host-ca-keys' });
    // Empty migrated DB → no CAs → 200 with empty body. The point is the route
    // was matched and handled, proving `hide` did not unregister it.
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('ssh-host-ca.pub');
  });

  it('a hidden CRL route is still MATCHED (handler 404, not framework 404)', async () => {
    const res = await app.inject({ method: 'GET', url: '/crl/does-not-exist.crl' });
    // CA not found → the handler returns { error: "CA with ID ... not found" }.
    // A framework "route not found" would instead carry a `message` field.
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toMatch(/not found/i);
    expect(body).not.toHaveProperty('message');
  });

  it('the hidden tRPC catch-all is still MATCHED and served', async () => {
    const res = await app.inject({ method: 'GET', url: '/trpc/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('pong');
  });
});
