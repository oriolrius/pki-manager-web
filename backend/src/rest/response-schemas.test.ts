/**
 * Fastify serializes a response with fast-json-stringify, which writes only the
 * keys that the response schema declares. An object schema with no `properties`
 * and no `additionalProperties` is therefore always sent as `{}`: the data is
 * dropped. `GET /api/v1/cas/:id` returned `subject: {}`, `issuer: {}` and
 * `extensions: {}` because of this. This test walks every response schema of the
 * REST API and fails on such an object.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerRestApi } from './index.js';

type Schema = Record<string, unknown>;

function emptyObjects(schema: unknown, path: string, out: string[]): void {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as Schema;
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (
    types.includes('object') &&
    s.properties === undefined &&
    s.additionalProperties === undefined &&
    s.patternProperties === undefined &&
    s.$ref === undefined &&
    s.oneOf === undefined &&
    s.anyOf === undefined &&
    s.allOf === undefined
  ) {
    out.push(path);
  }
  for (const [key, value] of Object.entries(s)) {
    if (key === 'properties' && value && typeof value === 'object') {
      for (const [name, sub] of Object.entries(value as Schema)) emptyObjects(sub, `${path}.${name}`, out);
    } else if (key === 'items' || key === 'additionalProperties') {
      emptyObjects(value, `${path}[]`, out);
    } else if ((key === 'oneOf' || key === 'anyOf' || key === 'allOf') && Array.isArray(value)) {
      value.forEach((sub, i) => emptyObjects(sub, `${path}.${key}[${i}]`, out));
    }
  }
}

describe('REST response schemas', () => {
  it('declare the content of every object, so the serializer does not drop it', async () => {
    const app = Fastify();
    const found: string[] = [];
    app.addHook('onRoute', (route) => {
      const response = (route.schema as { response?: Record<string, unknown> } | undefined)?.response;
      if (!response) return;
      const methods = Array.isArray(route.method) ? route.method.join(',') : route.method;
      for (const [status, schema] of Object.entries(response)) {
        emptyObjects(schema, `${methods} ${route.url} ${status}`, found);
      }
    });
    await registerRestApi(app);
    await app.ready();
    await app.close();
    expect(found).toEqual([]);
  });

  it('keeps the keys of an object declared with additionalProperties: true', async () => {
    const app = Fastify();
    const subject = { CN: 'ca.example', O: 'Example' };
    const route = (path: string, schema: Record<string, unknown>) =>
      app.get(path, { schema: { response: { 200: { type: 'object', properties: { subject: schema } } } } }, async () => ({ subject }));
    route('/open', { type: 'object', additionalProperties: true });
    route('/closed', { type: 'object' });
    const open = await app.inject({ method: 'GET', url: '/open' });
    const closed = await app.inject({ method: 'GET', url: '/closed' });
    await app.close();
    expect(open.json()).toEqual({ subject });
    // The behaviour that dropped the data: an object with no declared content is sent empty.
    expect(closed.json()).toEqual({ subject: {} });
  });
});
