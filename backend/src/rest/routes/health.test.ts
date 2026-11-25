import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';

const packageVersion = (
  JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

describe('GET /api/v1/health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(healthRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the release version from package.json', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; version: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(body.version).toBe(packageVersion);
    expect(body.version).not.toBe('1.0.0');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
