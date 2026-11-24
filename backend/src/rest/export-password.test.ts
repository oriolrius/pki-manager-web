import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRestApi } from './index.js';
import { resolveExportPassword } from './export-password.js';

const ID = '00000000-0000-4000-8000-000000000000';

describe('export password channel', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerRestApi(app);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  const call = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers });

  it('resolveExportPassword prefers the header, falls back to the query', () => {
    const req = (h: Record<string, string>) => ({ headers: h }) as never;
    expect(resolveExportPassword(req({ 'x-export-password': 'a' }), 'b')).toBe('a');
    expect(resolveExportPassword(req({}), 'b')).toBe('b');
    expect(resolveExportPassword(req({ 'x-export-password': '' }), undefined)).toBeUndefined();
  });

  it.each([
    [`/api/v1/cas/${ID}/download?format=p12-keystore`],
    [`/api/v1/certificates/${ID}/download?format=p12`],
  ])('missing password -> PASSWORD_REQUIRED (%s)', async (url) => {
    const res = await call(url);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PASSWORD_REQUIRED');
  });

  it.each([
    [`/api/v1/cas/${ID}/download?format=p12-keystore`],
    [`/api/v1/certificates/${ID}/download?format=p12`],
  ])('header password passes the password check (%s)', async (url) => {
    const res = await call(url, { 'x-export-password': 'Header-Pass-123' });
    expect(res.json().error?.code).not.toBe('PASSWORD_REQUIRED');
  });

  it('deprecated query password still passes the password check', async () => {
    const res = await call(`/api/v1/cas/${ID}/download?format=p12-keystore&password=Query-Pass-123`);
    expect(res.json().error?.code).not.toBe('PASSWORD_REQUIRED');
  });

  it('OpenAPI marks the query parameter deprecated and documents the header', () => {
    const spec = app.swagger() as { paths: Record<string, { get: { parameters: Array<{ name: string; in: string; deprecated?: boolean }> } }> };
    for (const path of ['/cas/{id}/download', '/certificates/{id}/download']) {
      const params = spec.paths[path].get.parameters;
      expect(params).toContainEqual(expect.objectContaining({
        name: 'password', in: 'query', description: expect.stringContaining('DEPRECATED'),
        schema: expect.objectContaining({ deprecated: true }),
      }));
      expect(params.some((p) => p.in === 'header' && p.name.toLowerCase() === 'x-export-password')).toBe(true);
    }
  });
});
