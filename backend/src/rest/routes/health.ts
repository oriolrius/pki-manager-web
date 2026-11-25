import type { FastifyInstance } from 'fastify';
import { APP_VERSION } from '../../lib/version.js';

/**
 * Health check routes for the REST API
 */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint for the REST API',
      tags: ['Dashboard'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['ok', 'degraded', 'error'],
              description: 'API health status',
            },
            version: {
              type: 'string',
              description: 'PKI Manager release version',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Current server timestamp',
            },
          },
          required: ['status', 'version', 'timestamp'],
        },
      },
    },
  }, async (_request, _reply) => {
    return {
      status: 'ok',
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
    };
  });
}
