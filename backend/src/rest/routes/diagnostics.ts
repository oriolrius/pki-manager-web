import type { FastifyInstance } from 'fastify';
import { isOIDCEnabled } from '../../lib/oidc.js';
import { getKMSService } from '../../kms/service.js';

const KEY_STORE_STATES = ['ready', 'sealed', 'uninitialized', 'unauthorized', 'unavailable'] as const;

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: { code: { type: 'string' }, message: { type: 'string' } },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
} as const;

/**
 * Operator diagnostics (admin only when OIDC is on).
 *
 * The health probes (`GET /health`, `GET /api/v1/health`) stay liveness checks with no
 * key store detail and no authentication. This route tells an operator why X.509 operations
 * answer `KEY_STORE_UNAVAILABLE`: sealed, not initialized, token refused, or not reachable.
 */
export async function diagnosticsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/diagnostics/key-store', {
    schema: {
      description:
        'State of the X.509 key store (OpenBao Transit). Admin only. Always HTTP 200 when the check ran; '
        + '`state` is `ready` when OpenBao is reachable, unsealed and accepts the backend token. '
        + 'The health probes do not depend on it.',
      tags: ['Dashboard'],
      response: {
        200: {
          type: 'object',
          properties: {
            provider: { type: 'string', enum: ['openbao'] },
            configured: { type: 'boolean', description: 'False when the OpenBao settings are missing or invalid' },
            state: { type: 'string', enum: [...KEY_STORE_STATES] },
            checkedAt: { type: 'string', format: 'date-time' },
          },
          required: ['provider', 'configured', 'state', 'checkedAt'],
        },
        403: errorSchema,
      },
    },
  }, async (request, reply) => {
    if (isOIDCEnabled() && !request.user?.roles?.includes('admin')) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Admin role required' } });
    }
    const { configured, state } = await getKMSService().diagnostics();
    return { provider: 'openbao' as const, configured, state, checkedAt: new Date().toISOString() };
  });
}
