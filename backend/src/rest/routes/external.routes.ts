import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates, auditLog } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { logger } from '../../lib/logger.js';
import { clusterAuthPreHandler } from '../middleware/cluster-auth.js';
import { randomUUID } from 'crypto';

/**
 * External issuer API consumed by the cert-manager external issuer controller.
 * All routes require Bearer token auth scoped to a single CA via clusters.ca_id.
 *
 * Routes:
 *   GET  /api/v1/external/health            - liveness check + cluster identity
 *   GET  /api/v1/external/ca-bundle         - PEM chain of cluster's CA
 *   POST /api/v1/external/sign              - sign CSR (returns cert + chain)
 *   POST /api/v1/external/revoke            - revoke certificate by serial
 *
 * Idempotency: sign accepts request_uid; repeat calls return cached cert.
 *
 * NOTE on signing: Cosmian KMS does not currently expose a public-key-only
 * import path in our wrapper. Until KMS Register-public-key support is added
 * (see task-109.05 notes), the sign endpoint returns 501 Not Implemented and
 * documents the integration contract used by the controller.
 */
export async function externalRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', clusterAuthPreHandler);

  // GET /health - probe used by Issuer reconciler
  fastify.get('/health', async (req) => {
    return {
      status: 'ok',
      cluster: { id: req.cluster!.id, name: req.cluster!.name, caId: req.cluster!.caId },
      timestamp: new Date().toISOString(),
    };
  });

  // GET /ca-bundle - PEM chain for cluster's CA
  fastify.get('/ca-bundle', async (req, reply) => {
    const caId = req.cluster!.caId;
    const ca = await db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      return reply.code(404).send({ error: { code: 'CA_NOT_FOUND', message: 'CA not found' } });
    }
    const kms = getKMSService();
    const pem = await kms.getCertificate(ca[0].kmsCertificateId, ca[0].id);
    return {
      caId,
      subjectDn: ca[0].subjectDn,
      certificatePem: pem,
      chainPem: pem,
    };
  });

  // POST /sign
  fastify.post<{
    Body: {
      csrPem: string;
      durationDays?: number;
      requestUid: string;
      certificateType?: 'server' | 'client' | 'dual';
      k8sNamespace?: string;
      k8sResource?: string;
      sanDns?: string[];
      sanIp?: string[];
    };
  }>('/sign', async (req, reply) => {
    const body = req.body;
    if (!body || !body.csrPem || !body.requestUid) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'csrPem and requestUid are required' },
      });
    }

    // Idempotency: return existing cert for same requestUid scoped to cluster
    const existing = await db
      .select()
      .from(certificates)
      .where(eq(certificates.requestUid, body.requestUid))
      .limit(1);

    if (existing.length > 0 && existing[0].k8sClusterId === req.cluster!.id) {
      const kms = getKMSService();
      const certPem = await kms.getCertificate(existing[0].kmsCertificateId, existing[0].id);
      const ca = await db
        .select()
        .from(certificateAuthorities)
        .where(eq(certificateAuthorities.id, existing[0].caId))
        .limit(1);
      const chainPem = ca[0] ? await kms.getCertificate(ca[0].kmsCertificateId, ca[0].id) : '';
      return {
        idempotent: true,
        id: existing[0].id,
        serialNumber: existing[0].serialNumber,
        certificatePem: certPem,
        chainPem,
        notBefore: existing[0].notBefore.toISOString(),
        notAfter: existing[0].notAfter.toISOString(),
      };
    }

    // TODO(task-109.05): Implement CSR-based signing via Cosmian KMS.
    // Steps required:
    //   1. Parse CSR (node-forge: forge.pki.certificationRequestFromPem)
    //   2. Verify CSR signature
    //   3. Import public key into Cosmian KMS via KMIP Register operation
    //      (extend backend/src/kms/service.ts with importPublicKey method)
    //   4. Call kmsService.signCertificate({ publicKeyId: imported, issuerPrivateKeyId: ca.kmsKeyId, ... })
    //   5. Persist certificate row with source_type='k8s', k8s_cluster_id, k8s_namespace,
    //      k8s_resource, request_uid
    //   6. Return PEM cert + chain
    logger.warn(
      { clusterId: req.cluster!.id, requestUid: body.requestUid },
      'External /sign called; CSR-based KMS signing not yet implemented'
    );

    await db.insert(auditLog).values({
      id: randomUUID(),
      operation: 'external.sign.unimplemented',
      entityType: 'cluster',
      entityId: req.cluster!.id,
      status: 'failure',
      details: JSON.stringify({
        requestUid: body.requestUid,
        k8sNamespace: body.k8sNamespace,
        k8sResource: body.k8sResource,
        reason: 'CSR signing path pending KMS Register-public-key implementation',
      }),
      ipAddress: req.ip,
    } as any);

    return reply.code(501).send({
      error: {
        code: 'NOT_IMPLEMENTED',
        message:
          'CSR-based signing pending Cosmian KMS public-key import support. See task-109.05.',
      },
    });
  });

  // POST /revoke
  fastify.post<{
    Body: { serialNumber: string; reason?: string };
  }>('/revoke', async (req, reply) => {
    const body = req.body;
    if (!body || !body.serialNumber) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'serialNumber is required' },
      });
    }

    const cert = await db
      .select()
      .from(certificates)
      .where(eq(certificates.serialNumber, body.serialNumber))
      .limit(1);

    if (!cert.length) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Certificate not found' },
      });
    }

    // Authorisation: cluster may only revoke certs it issued
    if (cert[0].k8sClusterId !== req.cluster!.id) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Cluster cannot revoke certificate it did not issue' },
      });
    }

    if (cert[0].status === 'revoked') {
      return {
        idempotent: true,
        id: cert[0].id,
        serialNumber: cert[0].serialNumber,
        status: 'revoked',
        revocationDate: cert[0].revocationDate?.toISOString(),
      };
    }

    const now = new Date();
    await db
      .update(certificates)
      .set({
        status: 'revoked',
        revocationDate: now,
        revocationReason: body.reason ?? 'unspecified',
        updatedAt: now,
      })
      .where(eq(certificates.id, cert[0].id));

    await db.insert(auditLog).values({
      id: randomUUID(),
      operation: 'external.revoke',
      entityType: 'certificate',
      entityId: cert[0].id,
      status: 'success',
      details: JSON.stringify({
        clusterId: req.cluster!.id,
        serialNumber: body.serialNumber,
        reason: body.reason ?? 'unspecified',
      }),
      ipAddress: req.ip,
    } as any);

    return {
      id: cert[0].id,
      serialNumber: cert[0].serialNumber,
      status: 'revoked',
      revocationDate: now.toISOString(),
    };
  });
}
