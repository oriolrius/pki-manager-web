/**
 * TASK-207: the SSH & external REST routes must publish request-body and response JSON
 * schemas in the generated OpenAPI, so openapi-python-client can build typed requests and
 * return models (previously these routes emitted body-less stubs with empty responses).
 *
 * These tests also guard the two Fastify hazards the fix has to respect:
 *  - response schemas must NOT strip real response fields (fast-json-stringify), and
 *  - body schemas must NOT reject a valid body the handler's Zod `.strip()` parse accepts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerOpenAPI } from '../openapi.js';
import { sshRoutes } from './ssh.routes.js';
import { externalRoutes } from './external.routes.js';
import { registerSshExternalRoutes } from './ssh-external.routes.js';
import {
  zodBodySchema,
  okObjectResponse,
  okArrayResponse,
} from '../schemas/ssh-openapi-schemas.js';
import { createSshCaSchema, createIdentitySchema } from '../../trpc/ssh-schemas.js';

type AnyRec = Record<string, any>;

/** Resolve a swagger path item by exact key or by suffix (routes may carry a baked-in prefix). */
function pathItem(spec: AnyRec, suffix: string): AnyRec | undefined {
  const paths = spec.paths as AnyRec;
  const key = Object.keys(paths).find((k) => k === suffix || k.endsWith(suffix));
  return key ? paths[key] : undefined;
}

function requestBodySchema(spec: AnyRec, suffix: string, method = 'post'): AnyRec | undefined {
  const op = pathItem(spec, suffix)?.[method];
  return op?.requestBody?.content?.['application/json']?.schema;
}

function responseSchema(spec: AnyRec, suffix: string, method: string, status = '200'): AnyRec | undefined {
  const op = pathItem(spec, suffix)?.[method];
  return op?.responses?.[status]?.content?.['application/json']?.schema;
}

describe('TASK-207 — SSH & external OpenAPI schemas', () => {
  let app: FastifyInstance;
  let spec: AnyRec;

  beforeAll(async () => {
    app = Fastify();
    await registerOpenAPI(app);

    // Register the three route groups so their paths land in the generated swagger.
    await app.register(sshRoutes, { prefix: '/ssh' });
    await app.register(externalRoutes, { prefix: '/external' });
    registerSshExternalRoutes(app); // paths are absolute (/api/v1/external/ssh/*)

    // --- Throwaway routes proving the two Fastify hazards are handled ---
    // (3) response schema must not strip undeclared fields.
    app.get('/t207/obj', { schema: { response: { 200: okObjectResponse } } },
      async () => ({ a: 1, extra: 'kept' }));
    app.get('/t207/arr', { schema: { response: { 200: okArrayResponse } } },
      async () => ([{ a: 1, extra: 'kept' }]));
    // (4) a valid body must not be rejected by Fastify's ajv (extra keys allowed).
    app.post('/t207/echo', { schema: { body: zodBodySchema(createIdentitySchema) } },
      async (req) => req.body);
    app.post('/t207/echo-ca', { schema: { body: zodBodySchema(createSshCaSchema) } },
      async (req) => req.body);

    await app.ready();
    spec = app.swagger() as AnyRec;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('AC#1/#2 — SSH routes document requestBody + 200 response', () => {
    const sshPosts = ['/ssh/cas', '/ssh/hosts', '/ssh/users/issue', '/ssh/tokens', '/ssh/blocks'];
    it.each(sshPosts)('%s has a JSON request body schema with properties', (p) => {
      const body = requestBodySchema(spec, p);
      expect(body, `requestBody for POST ${p}`).toBeDefined();
      expect(body!.type).toBe('object');
      expect(Object.keys(body!.properties ?? {}).length).toBeGreaterThan(0);
    });
    it.each(sshPosts)('%s has a 200 response schema', (p) => {
      expect(responseSchema(spec, p, 'post'), `200 response for POST ${p}`).toBeDefined();
    });
    it('a SSH list endpoint (GET /ssh/cas) documents an array 200 response', () => {
      const schema = responseSchema(spec, '/ssh/cas', 'get');
      expect(schema).toBeDefined();
      expect(schema!.type).toBe('array');
    });

    // TASK-215: markPushed used to be tRPC-only, so it was absent from the spec
    // and unreachable from Swagger / a generated client.
    it('POST /ssh/hosts/{id}/auth-principals/pushed is in the spec with a 200 response', () => {
      const item = pathItem(spec, '/ssh/hosts/{id}/auth-principals/pushed');
      expect(item, 'markPushed path missing from OpenAPI').toBeDefined();
      expect(item!.post, 'markPushed must be a POST').toBeDefined();
      expect(responseSchema(spec, '/ssh/hosts/{id}/auth-principals/pushed', 'post')).toBeDefined();
    });
  });

  describe('AC#1/#2 — external issuer routes document requestBody + 200 response', () => {
    const externalPosts = ['/external/sign', '/external/revoke'];
    it.each(externalPosts)('%s has a JSON request body schema', (p) => {
      const body = requestBodySchema(spec, p);
      expect(body, `requestBody for POST ${p}`).toBeDefined();
      expect(body!.type).toBe('object');
      expect(Object.keys(body!.properties ?? {}).length).toBeGreaterThan(0);
    });
    it.each(externalPosts)('%s has a 200 response schema', (p) => {
      expect(responseSchema(spec, p, 'post'), `200 response for POST ${p}`).toBeDefined();
    });
    it('POST /external/sign requires csrPem + requestUid (and nothing more)', () => {
      const body = requestBodySchema(spec, '/external/sign');
      expect(body!.required).toEqual(expect.arrayContaining(['csrPem', 'requestUid']));
      expect(body!.required).toHaveLength(2);
      expect(body!.additionalProperties).toBe(true);
    });
  });

  describe('AC#1/#2 — fleet-token SSH routes document requestBody + 200 response', () => {
    const fleetPosts = ['/external/ssh/sign-host', '/external/ssh/sign-user'];
    it.each(fleetPosts)('%s has a JSON request body schema', (p) => {
      const body = requestBodySchema(spec, p);
      expect(body, `requestBody for POST ${p}`).toBeDefined();
      expect(body!.type).toBe('object');
      expect(Object.keys(body!.properties ?? {}).length).toBeGreaterThan(0);
    });
    it.each(fleetPosts)('%s has a 200 response schema', (p) => {
      expect(responseSchema(spec, p, 'post'), `200 response for POST ${p}`).toBeDefined();
    });
    it('body schemas allow extra keys (additionalProperties:true) so valid bodies are never rejected', () => {
      for (const p of fleetPosts) {
        expect(requestBodySchema(spec, p)!.additionalProperties).toBe(true);
      }
    });
  });

  describe('Hazard 2 — response schemas do not strip real fields', () => {
    it('object response keeps arbitrary extra keys', async () => {
      const r = await app.inject({ method: 'GET', url: '/t207/obj' });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.a).toBe(1);
      expect(body.extra).toBe('kept');
    });
    it('array-of-objects response keeps arbitrary extra keys', async () => {
      const r = await app.inject({ method: 'GET', url: '/t207/arr' });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body[0].a).toBe(1);
      expect(body[0].extra).toBe('kept');
    });
  });

  describe('Hazard 1 — a valid body (with extra keys) is not rejected', () => {
    it('createIdentity body (with format:email + an extra key) echoes back at 200', async () => {
      const payload = { subject: 'alice', email: 'alice@example.com', unknownExtra: 'kept' };
      const r = await app.inject({ method: 'POST', url: '/t207/echo', payload });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.subject).toBe('alice');
      expect(body.email).toBe('alice@example.com');
      expect(body.unknownExtra).toBe('kept'); // additionalProperties:true => not stripped by ajv
    });
    it('createSshCa body (enum field) is accepted', async () => {
      const r = await app.inject({ method: 'POST', url: '/t207/echo-ca', payload: { caType: 'host' } });
      expect(r.statusCode).toBe(200);
      expect(r.json().caType).toBe('host');
    });
  });
});
