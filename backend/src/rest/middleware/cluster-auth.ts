import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { getClusterService } from '../../services/cluster.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    cluster?: { id: string; name: string; caId: string };
  }
}

/**
 * preHandler verifying Authorization: Bearer <token> against clusters table.
 * Constant-time hash comparison done inside ClusterService.verifyToken.
 * Updates last_seen on success.
 */
export async function clusterAuthPreHandler(
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
  const svc = getClusterService();
  const cluster = await svc.verifyToken({ db, ipAddress: req.ip }, token);
  if (!cluster) {
    reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or revoked cluster token' },
    });
    return;
  }
  req.cluster = cluster;
}
