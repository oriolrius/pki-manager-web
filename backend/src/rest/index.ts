import type { FastifyInstance } from 'fastify';
import { registerOpenAPI } from './openapi.js';
import { healthRoutes } from './routes/health.js';
import { caRoutes } from './routes/ca.routes.js';

/**
 * Register all REST API routes and plugins
 *
 * This plugin sets up:
 * - OpenAPI/Swagger documentation at /api/docs
 * - REST API routes under /api/v1 prefix
 */
export async function registerRestApi(fastify: FastifyInstance): Promise<void> {
  // Register OpenAPI/Swagger documentation
  await registerOpenAPI(fastify);

  // Register REST API routes under /api/v1 prefix
  await fastify.register(
    async (api) => {
      // Health check endpoint for the REST API
      await api.register(healthRoutes);

      // CA routes - Certificate Authority management
      await api.register(caRoutes, { prefix: '/cas' });

      // Future route registrations will go here:
      // await api.register(certificateRoutes, { prefix: '/certificates' });
      // await api.register(bulkRoutes, { prefix: '/certificates/bulk' });
      // await api.register(crlRoutes, { prefix: '/crls' });
      // await api.register(searchRoutes);
      // await api.register(dashboardRoutes, { prefix: '/dashboard' });
      // await api.register(auditRoutes, { prefix: '/audit' });
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
}
