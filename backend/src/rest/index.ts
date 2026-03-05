import type { FastifyInstance, FastifyError } from 'fastify';
import yaml from 'js-yaml';
import { registerOpenAPI } from './openapi.js';
import { healthRoutes } from './routes/health.js';
import { caRoutes } from './routes/ca.routes.js';
import { certificateRoutes } from './routes/certificate.routes.js';
import { bulkRoutes } from './routes/bulk.routes.js';
import { utilityRoutes } from './routes/utility.routes.js';
import { createAuthPreHandler } from './middleware/auth.js';

/**
 * Register all REST API routes and plugins
 *
 * This plugin sets up:
 * - OpenAPI/Swagger documentation at /api/docs
 * - REST API routes under /api/v1 prefix
 * - Custom error handler for consistent error responses
 */
export async function registerRestApi(fastify: FastifyInstance): Promise<void> {
  // Register OpenAPI/Swagger documentation
  await registerOpenAPI(fastify);

  // Register REST API routes under /api/v1 prefix
  await fastify.register(
    async (api) => {
      // Create auth preHandler that skips authentication for public endpoints
      const authHandler = createAuthPreHandler([
        '/api/v1/health',        // Health check
        '/api/v1/openapi.json',  // OpenAPI spec JSON
        '/api/v1/openapi.yaml',  // OpenAPI spec YAML
      ]);

      // Register auth preHandler for all routes in this context
      api.addHook('preHandler', authHandler);

      // Custom error handler to convert Fastify validation errors to our standard format
      api.setErrorHandler((error: FastifyError, _request, reply) => {
        // Handle validation errors (from Fastify schema validation)
        if (error.validation) {
          const details = error.validation.map((v) => ({
            field: v.instancePath || v.params?.missingProperty || 'unknown',
            message: v.message || 'Validation failed',
          }));

          return reply.status(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: error.message || 'Request validation failed',
              details,
            },
          });
        }

        // Handle other known Fastify errors
        if (error.statusCode && error.statusCode < 500) {
          return reply.status(error.statusCode).send({
            error: {
              code: error.code || 'REQUEST_ERROR',
              message: error.message,
            },
          });
        }

        // Handle internal server errors
        api.log.error(error);
        return reply.status(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      });

      // Health check endpoint for the REST API
      await api.register(healthRoutes);

      // CA routes - Certificate Authority management
      await api.register(caRoutes, { prefix: '/cas' });

      // Certificate routes - Certificate management
      await api.register(certificateRoutes, { prefix: '/certificates' });

      // Bulk operations routes - Certificate bulk operations
      await api.register(bulkRoutes, { prefix: '/certificates/bulk' });

      // Utility routes - Search, Domains, Dashboard, Audit, Reports
      await api.register(utilityRoutes);
    },
    { prefix: '/api/v1' }
  );

  // Add OpenAPI JSON endpoint
  fastify.get('/api/v1/openapi.json', {
    schema: {
      hide: true, // Hide from documentation
    },
  }, async (_request, reply) => {
    return reply.send(fastify.swagger());
  });

  // Add OpenAPI YAML endpoint
  fastify.get('/api/v1/openapi.yaml', {
    schema: {
      hide: true, // Hide from documentation
    },
  }, async (_request, reply) => {
    const spec = fastify.swagger();
    const yamlSpec = yaml.dump(spec, { lineWidth: -1, noRefs: true });
    return reply.type('text/yaml').send(yamlSpec);
  });
}
