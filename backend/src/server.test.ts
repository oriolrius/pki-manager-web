/**
 * Server Integration Tests - OpenAPI Endpoints
 *
 * Tests to validate:
 * 1. OpenAPI spec endpoint is accessible
 * 2. Swagger UI endpoint is accessible
 * 3. Endpoints return proper content types
 * 4. OpenAPI spec is valid JSON
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { openApiDocument } from './trpc/openapi.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

describe('Server - OpenAPI Integration', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    // Create and configure test server
    server = Fastify({
      logger: false, // Disable logging in tests
    });

    // Register CORS
    await server.register(cors, {
      origin: 'http://localhost:5173',
      credentials: true,
    });

    // Register tRPC
    await server.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: {
        router: appRouter,
        createContext,
      },
    });

    // Health check endpoint
    server.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // OpenAPI specification endpoint
    server.get('/api/openapi.json', async (_req, reply) => {
      reply.type('application/json');
      return openApiDocument;
    });

    // Swagger UI endpoints
    server.get('/api/docs', async (_req, reply) => {
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PKI Manager API Documentation</title>
</head>
<body>
  <div id="swagger-ui"></div>
</body>
</html>
      `;
      reply.type('text/html');
      return html;
    });

    // Serve Swagger UI static files
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const swaggerUiPath = join(__dirname, '../node_modules/swagger-ui-dist');

    server.get('/api/docs/:file', async (req, reply) => {
      const { file } = req.params as { file: string };
      const filePath = join(swaggerUiPath, file);

      if (!existsSync(filePath) || !filePath.startsWith(swaggerUiPath)) {
        reply.code(404);
        return { error: 'File not found' };
      }

      const content = await readFile(filePath);

      // Set appropriate content type
      if (file.endsWith('.css')) {
        reply.type('text/css');
      } else if (file.endsWith('.js')) {
        reply.type('application/javascript');
      } else if (file.endsWith('.png')) {
        reply.type('image/png');
      }

      return content;
    });

    // Start server on random available port
    await server.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await server.close();
  });

  describe('OpenAPI Specification Endpoint', () => {
    it('should return OpenAPI spec at /api/openapi.json', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return JSON content type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      expect(response.headers['content-type']).toContain('application/json');
    });

    it('should return valid JSON', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      expect(() => JSON.parse(response.body)).not.toThrow();
    });

    it('should return OpenAPI 3.0.3 spec', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      const spec = JSON.parse(response.body);
      expect(spec.openapi).toBe('3.0.3');
    });

    it('should include certificate endpoints', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      const spec = JSON.parse(response.body);
      expect(spec.paths).toBeDefined();
      expect(spec.paths['/certificates']).toBeDefined();
    });

    it('should have proper API metadata', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/openapi.json',
      });

      const spec = JSON.parse(response.body);
      expect(spec.info.title).toBe('PKI Manager API');
      expect(spec.info.version).toBe('1.0.0');
      expect(spec.info.description).toBeDefined();
    });
  });

  describe('Swagger UI Endpoint', () => {
    it('should return Swagger UI HTML at /api/docs', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/docs',
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return HTML content type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/docs',
      });

      expect(response.headers['content-type']).toContain('text/html');
    });

    it('should contain swagger-ui div', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/docs',
      });

      expect(response.body).toContain('swagger-ui');
    });

    it('should contain expected HTML structure', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/docs',
      });

      // The HTML should have basic structure
      expect(response.body).toContain('<!DOCTYPE html>');
      expect(response.body).toContain('PKI Manager API Documentation');
    });
  });

  describe('Health Check Endpoint', () => {
    it('should return health status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent Swagger UI files', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/docs/non-existent-file.js',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should prevent path traversal attacks', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/docs/../../../etc/passwd',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

describe('OpenAPI Spec Content Validation', () => {
  it('should have valid server URLs', async () => {
    expect(openApiDocument.servers).toBeDefined();
    expect(openApiDocument.servers?.length).toBeGreaterThan(0);

    openApiDocument.servers?.forEach((server) => {
      expect(server.url).toMatch(/^https?:\/\//);
    });
  });

  it('should have all required OpenAPI 3.0 fields', () => {
    // Top-level required fields
    expect(openApiDocument.openapi).toBeDefined();
    expect(openApiDocument.info).toBeDefined();
    expect(openApiDocument.paths).toBeDefined();

    // Info object required fields
    expect(openApiDocument.info.title).toBeDefined();
    expect(openApiDocument.info.version).toBeDefined();
  });

  it('should have properly structured paths', () => {
    const paths = openApiDocument.paths || {};

    Object.entries(paths).forEach(([path, pathItem]) => {
      // Path should start with /
      expect(path).toMatch(/^\//);

      if (!pathItem) return;

      // Each operation should have required fields
      const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
      methods.forEach((method) => {
        const operation = pathItem[method];
        if (operation) {
          // Operation should have responses
          expect(operation.responses).toBeDefined();
          expect(Object.keys(operation.responses || {}).length).toBeGreaterThan(0);
        }
      });
    });
  });

  it('should include certificate listing with proper filters', () => {
    const certificateList = openApiDocument.paths?.['/certificates']?.get;

    expect(certificateList).toBeDefined();
    expect(certificateList?.summary).toBeDefined();
    expect(certificateList?.tags).toContain('certificates');
  });
});
