import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { getIntegrationService } from '../../services/integration.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    integration?: { id: string; name: string; caId: string; kind: 'kubernetes' | 'scep' | 'generic' };
  }
}

/**
 * preHandler verifying Authorization: Bearer <token> against integrations table.
 * Constant-time hash comparison done inside IntegrationService.verifyToken.
 * Updates last_seen on success.
 */
export async function integrationAuthPreHandler(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
    });
    return;
  }
  const token = auth.slice('Bearer '.length).trim();
  const svc = getIntegrationService();
  const integration = await svc.verifyToken({ db, ipAddress: req.ip }, token);
  if (!integration) {
    reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or revoked service token' },
    });
    return;
  }
  req.integration = integration;
}
