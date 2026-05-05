import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import forge from 'node-forge';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates, auditLog } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { logger } from '../../lib/logger.js';
import { parseCertificate } from '../../crypto/x509.js';
import { buildCertificateExtensions } from '../../services/certificate.service.js';
import { clusterAuthPreHandler } from '../middleware/cluster-auth.js';
import { randomUUID } from 'crypto';

type ExternalCertType = 'server' | 'client' | 'dual';

interface ParsedCsr {
  subjectDn: string;
  cn: string;
  sanDns: string[];
  sanIp: string[];
  sanEmail: string[];
}

function parseCsrPem(csrPem: string): ParsedCsr {
  const csr = forge.pki.certificationRequestFromPem(csrPem);
  if (!csr.verify()) {
    throw new Error('CSR signature verification failed');
  }
  const fields = ['CN', 'O', 'OU', 'C', 'ST', 'L'] as const;
  const parts: string[] = [];
  let cn = '';
  for (const f of fields) {
    const attr = csr.subject.getField(f);
    if (attr?.value) {
      parts.push(`${f}=${attr.value}`);
      if (f === 'CN') cn = String(attr.value);
    }
  }
  const subjectDn = parts.join(',');

  const sanDns: string[] = [];
  const sanIp: string[] = [];
  const sanEmail: string[] = [];

  // node-forge: extensionRequest attribute holds requested extensions
  const extReq = csr.getAttribute({ name: 'extensionRequest' }) as
    | { extensions?: Array<{ name?: string; altNames?: Array<{ type: number; value?: string; ip?: string }> }> }
    | undefined;
  const exts = extReq?.extensions ?? [];
  for (const ext of exts) {
    if (ext.name === 'subjectAltName' && Array.isArray(ext.altNames)) {
      for (const an of ext.altNames) {
        // type 2=DNS, 7=IP, 1=email per RFC 5280
        if (an.type === 2 && an.value) sanDns.push(an.value);
        else if (an.type === 7 && an.ip) sanIp.push(an.ip);
        else if (an.type === 1 && an.value) sanEmail.push(an.value);
      }
    }
  }
  return { subjectDn, cn, sanDns, sanIp, sanEmail };
}

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

    // Parse + verify CSR
    let parsed: ParsedCsr;
    try {
      parsed = parseCsrPem(body.csrPem);
    } catch (err) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_CSR',
          message: err instanceof Error ? err.message : 'Invalid CSR',
        },
      });
    }
    if (!parsed.cn) {
      return reply.code(400).send({
        error: { code: 'INVALID_CSR', message: 'CSR subject must include CN' },
      });
    }

    // Load CA bound to this cluster
    const caRows = await db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, req.cluster!.caId))
      .limit(1);
    if (!caRows.length) {
      return reply.code(404).send({
        error: { code: 'CA_NOT_FOUND', message: 'CA bound to cluster not found' },
      });
    }
    const ca = caRows[0];
    if (ca.status !== 'active') {
      return reply.code(409).send({
        error: { code: 'CA_NOT_ACTIVE', message: `CA status: ${ca.status}` },
      });
    }
    if (new Date() > ca.notAfter) {
      return reply.code(409).send({
        error: { code: 'CA_EXPIRED', message: 'CA expired' },
      });
    }

    const certificateType: ExternalCertType = body.certificateType ?? 'dual';
    const durationDays = Math.min(Math.max(body.durationDays ?? 90, 1), 825);

    // Merge SANs from CSR with optional body overrides (cert-manager may not echo SANs in CSR
    // when usages-only requests are made; defensive merge is safe)
    const sanDns = Array.from(new Set([...parsed.sanDns, ...(body.sanDns ?? [])]));
    const sanIp = Array.from(new Set([...parsed.sanIp, ...(body.sanIp ?? [])]));
    const sanEmail = parsed.sanEmail;

    const x509Extensions = buildCertificateExtensions({
      certificateType,
      sanDns: sanDns.length ? sanDns : undefined,
      sanIp: sanIp.length ? sanIp : undefined,
      sanEmail: sanEmail.length ? sanEmail : undefined,
    });

    const certId = randomUUID();
    const kms = getKMSService();

    try {
      logger.info(
        { certId, clusterId: req.cluster!.id, cn: parsed.cn, caId: ca.id },
        'Signing CSR via KMS for k8s cluster'
      );

      const certInfo = await kms.signCertificate({
        csr: body.csrPem,
        issuerPrivateKeyId: ca.kmsKeyId,
        issuerCertificateId: ca.kmsCertificateId,
        issuerName: ca.subjectDn,
        subjectName: parsed.subjectDn,
        daysValid: durationDays,
        tags: [`cluster:${req.cluster!.id}`, `request_uid:${body.requestUid}`],
        entityId: certId,
        x509Extensions,
      });

      const certBase64 = Buffer.from(certInfo.certificateData, 'hex').toString('base64');
      const certificatePem = `-----BEGIN CERTIFICATE-----\n${certBase64
        .match(/.{1,64}/g)
        ?.join('\n')}\n-----END CERTIFICATE-----`;
      const certMeta = parseCertificate(certificatePem, 'PEM');

      await db.insert(certificates).values({
        id: certId,
        caId: ca.id,
        subjectDn: parsed.subjectDn,
        serialNumber: certMeta.serialNumber,
        certificateType,
        notBefore: certMeta.validity.notBefore,
        notAfter: certMeta.validity.notAfter,
        kmsCertificateId: certInfo.certificateId,
        kmsKeyId: null, // private key never reaches PKI Manager
        status: 'active',
        sanDns: sanDns.length ? JSON.stringify(sanDns) : null,
        sanIp: sanIp.length ? JSON.stringify(sanIp) : null,
        sanEmail: sanEmail.length ? JSON.stringify(sanEmail) : null,
        sourceType: 'k8s',
        k8sClusterId: req.cluster!.id,
        k8sNamespace: body.k8sNamespace ?? null,
        k8sResource: body.k8sResource ?? null,
        requestUid: body.requestUid,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      await db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'external.sign',
        entityType: 'certificate',
        entityId: certId,
        status: 'success',
        details: JSON.stringify({
          clusterId: req.cluster!.id,
          caId: ca.id,
          requestUid: body.requestUid,
          subjectDn: parsed.subjectDn,
          serialNumber: certMeta.serialNumber,
          k8sNamespace: body.k8sNamespace,
          k8sResource: body.k8sResource,
          certificateType,
        }),
        ipAddress: req.ip,
      } as any);

      const chainPem = await kms.getCertificate(ca.kmsCertificateId, ca.id);

      return {
        idempotent: false,
        id: certId,
        serialNumber: certMeta.serialNumber,
        certificatePem,
        chainPem,
        notBefore: certMeta.validity.notBefore.toISOString(),
        notAfter: certMeta.validity.notAfter.toISOString(),
      };
    } catch (err) {
      logger.error(
        { err, clusterId: req.cluster!.id, requestUid: body.requestUid },
        'External /sign failed'
      );
      await db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'external.sign',
        entityType: 'cluster',
        entityId: req.cluster!.id,
        status: 'failure',
        details: JSON.stringify({
          requestUid: body.requestUid,
          subjectDn: parsed.subjectDn,
          error: err instanceof Error ? err.message : String(err),
        }),
        ipAddress: req.ip,
      } as any);
      return reply.code(500).send({
        error: {
          code: 'SIGN_FAILED',
          message: err instanceof Error ? err.message : 'Signing failed',
        },
      });
    }
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
