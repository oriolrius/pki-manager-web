/**
 * The published API reference (docs site) is generated from this OpenAPI document,
 * so it must describe the real routes. This test fails when:
 *  - a route under /api/v1 is missing from the document (and is not hidden on purpose),
 *  - the document lists an operation that no route serves,
 *  - a route validates a request body that the document does not show, or the reverse,
 *  - a route is hidden from the document without being in HIDDEN_ON_PURPOSE.
 * Route registration mirrors src/server.ts (REST, external issuer, SSH external).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance, type RouteOptions } from 'fastify';
import { registerRestApi } from './index.js';
import { externalRoutes } from './routes/external.routes.js';
import { registerSshExternalRoutes } from './routes/ssh-external.routes.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
/** /api/v1 routes that are deliberately not in the document: the document itself and its UI. */
const HIDDEN_ON_PURPOSE = new Set<string>(['GET /openapi.json', 'GET /openapi.yaml']);

type Seen = { key: string; path: string; method: string; hasBody: boolean; hidden: boolean };

let app: FastifyInstance;
const routes: Seen[] = [];
let spec: { paths: Record<string, Record<string, { requestBody?: unknown }>> };

/** Fastify `/cas/:id` -> OpenAPI `/cas/{id}`, relative to the /api/v1 server base. */
const toSpecPath = (url: string) => norm(url.replace(/^\/api\/v1/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}'));
/** `/cas/` and `/cas` are the same route (Fastify prefix + '/'). */
const norm = (p: string) => p.replace(/\/+$/, '') || '/';

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.addHook('onRoute', (r: RouteOptions) => {
    const methods = (Array.isArray(r.method) ? r.method : [r.method]).map(String).filter((m) => METHODS.includes(m));
    if (!r.url.startsWith('/api/v1/') && r.url !== '/api/v1') return;
    for (const method of methods) {
      const path = toSpecPath(r.url);
      const schema = (r.schema ?? {}) as { body?: unknown; hide?: boolean };
      routes.push({ key: `${method} ${path}`, path, method: method.toLowerCase(), hasBody: !!schema.body, hidden: !!schema.hide });
    }
  });
  await registerRestApi(app);
  await app.register(externalRoutes, { prefix: '/api/v1/external' });
  registerSshExternalRoutes(app);
  await app.ready();
  const raw = app.swagger() as typeof spec;
  spec = { paths: Object.fromEntries(Object.entries(raw.paths).map(([p, ops]) => [norm(p), { ...(spec?.paths[norm(p)] ?? {}), ...ops }])) };
});

afterAll(async () => {
  await app.close();
});

describe('OpenAPI document matches the registered routes', () => {
  it('registers a realistic number of /api/v1 routes', () => {
    expect(routes.length).toBeGreaterThan(80);
  });

  it('documents every visible /api/v1 route', () => {
    const missing = routes
      .filter((r) => !r.hidden && !HIDDEN_ON_PURPOSE.has(r.key))
      .filter((r) => !spec.paths[r.path]?.[r.method])
      .map((r) => r.key);
    expect(missing).toEqual([]);
  });

  it('hides only the routes listed in HIDDEN_ON_PURPOSE', () => {
    const hidden = routes.filter((r) => r.hidden || !spec.paths[r.path]?.[r.method]).map((r) => r.key);
    expect(hidden.filter((k) => !HIDDEN_ON_PURPOSE.has(k))).toEqual([]);
  });

  it('lists no operation that no route serves', () => {
    const served = new Set(routes.map((r) => r.key));
    const ghosts: string[] = [];
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const method of Object.keys(ops)) {
        if (METHODS.includes(method.toUpperCase()) && !served.has(`${method.toUpperCase()} ${path}`)) ghosts.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(ghosts).toEqual([]);
  });

  it('shows a request body exactly where the route validates one', () => {
    const mismatch = routes
      .filter((r) => spec.paths[r.path]?.[r.method])
      .filter((r) => r.hasBody !== !!spec.paths[r.path][r.method].requestBody)
      .map((r) => `${r.key}: route body schema=${r.hasBody}, document requestBody=${!!spec.paths[r.path][r.method].requestBody}`);
    expect(mismatch).toEqual([]);
  });
});
