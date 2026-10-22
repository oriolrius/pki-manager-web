import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { OpenAPIV3_1 } from 'openapi-types';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { registerOpenAPI } from './openapi.js';
import { externalRoutes } from './routes/external.routes.js';

describe('integration and SCEP API documentation', () => {
  let app: FastifyInstance;
  let spec: OpenAPIV3_1.Document;
  beforeAll(async () => {
    app = Fastify();
    await registerOpenAPI(app);
    await app.register(externalRoutes, { prefix: '/external' });
    await app.ready();
    spec = app.swagger() as OpenAPIV3_1.Document;
  });
  afterAll(async () => { await app.close(); });

  it('uses the service-token scheme for all external operations instead of inheriting OIDC', () => {
    expect(spec.components?.securitySchemes?.integrationToken).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(spec.components?.securitySchemes?.bearerAuth).toMatchObject({ bearerFormat: 'JWT' });
    for (const [path, method] of [
      ['/external/health', 'get'], ['/external/ca-bundle', 'get'],
      ['/external/certificate-status/{serial}', 'get'],
      ['/external/sign', 'post'], ['/external/revoke', 'post'],
    ] as const) {
      expect(spec.paths?.[path]?.[method]?.security).toEqual([{ integrationToken: [] }]);
    }
  });

  it('documents generic identity, renewal status, signing responses and ignored compatibility SAN fields', () => {
    expect(spec.paths?.['/external/health']?.get?.responses?.['200']).toMatchObject({
      content: { 'application/json': { schema: { properties: {
        integration: { properties: { kind: { enum: ['kubernetes', 'scep', 'generic'] } } },
        cluster: { deprecated: true },
      } } } },
    });
    expect(spec.paths?.['/external/certificate-status/{serial}']?.get?.responses?.['200']).toMatchObject({
      content: { 'application/json': { schema: { properties: { active: { type: 'boolean' } } } } },
    });
    expect(spec.paths?.['/external/sign']?.post?.responses?.['200']).toMatchObject({
      content: { 'application/json': { schema: { additionalProperties: true, properties: {
        idempotent: { type: 'boolean' }, certificatePem: { type: 'string' },
        chainPem: { type: 'string' }, notAfter: { format: 'date-time' },
      } } } },
    });
    expect(spec.paths?.['/external/sign']?.post?.requestBody).toMatchObject({
      content: { 'application/json': { schema: { properties: { sanDns: { deprecated: true }, sanIp: { deprecated: true } } } } },
    });
    expect(spec.info.description).toContain('/trpc/integration.*');
  });

  it('keeps the device protocol in a separate gateway specification without bearer authentication', () => {
    const gateway = yaml.load(readFileSync(new URL('../../../scep/openapi.yaml', import.meta.url), 'utf8')) as OpenAPIV3_1.Document;
    expect(gateway.openapi).toBe('3.1.0');
    expect(gateway.security).toEqual([]);
    expect(Object.keys(gateway.paths ?? {})).toEqual(['/scep']);
    expect(gateway.paths?.['/scep']?.post?.requestBody).toMatchObject({
      required: true, content: { 'application/x-pki-message': { schema: { format: 'binary' } } },
    });
    expect(gateway.paths?.['/scep']?.post?.responses?.['200']?.description).toContain('pkiStatus');
    expect(spec.paths).not.toHaveProperty('/scep');
    expect(spec.paths).not.toHaveProperty('/trpc/integration.register');
  });
});
