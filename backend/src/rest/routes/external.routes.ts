import type { FastifyError, FastifyInstance } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import forge from 'node-forge';
import { db } from '../../db/client.js';
import { certificateAuthorities, certificates, auditLog } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { getCRLService } from '../../services/crl.service.js';
import { crlDistributionUrl } from '../../lib/crl-url.js';
import { logger } from '../../lib/logger.js';
import { parseCertificate } from '../../crypto/x509.js';
import { integrationAuthPreHandler } from '../middleware/integration-auth.js';
import { randomUUID } from 'crypto';
import { externalHealthResponse, externalBundleResponse, externalStatusResponse, externalSignResponse, externalRevokeResponse } from '../schemas/external-openapi-schemas.js';
import { errorResponse } from '../schemas/ssh-openapi-schemas.js';

// --- OpenAPI schemas (TASK-207) --------------------------------------------------------
// The external issuer API is consumed by generated clients; document its request bodies and
// responses. Bodies use `additionalProperties: true` (the handlers validate manually and
// tolerate extra keys) and keep `required` to exactly what each handler enforces. Responses
// are the permissive object shape so fast-json-stringify never strips real fields. Error
// responses are intentionally NOT declared: schema-validation failures surface Fastify's
// default `{ statusCode, error, message }` shape, which an `{ error: {...} }` response schema
// would corrupt.
const externalTag = ['External Issuer'];

const signBodySchema = {
  type: 'object',
  required: ['csrPem', 'requestUid'],
  additionalProperties: true,
  properties: {
    csrPem: { type: 'string', description: 'PEM-encoded PKCS#10 CSR to sign' },
    requestUid: {
      type: 'string',
      description: 'Idempotency key scoped to this integration and CA. A retry returns the active cached certificate; revoked or expired cached certificates return 409.',
    },
    durationDays: {
      type: 'number',
      description: 'Requested validity in days (clamped server-side to 1..825; default 90)',
    },
    certificateType: { type: 'string', enum: ['server', 'client', 'dual'], description: 'Metadata hint only. Key usage and extended key usage are taken from the signed CSR.' },
    k8sNamespace: { type: 'string' },
    k8sResource: { type: 'string' },
    sanDns: { type: 'array', items: { type: 'string' }, deprecated: true, description: 'Ignored compatibility field. SAN identities must be included in the signed CSR.' },
    sanIp: { type: 'array', items: { type: 'string' }, deprecated: true, description: 'Ignored compatibility field. IP identities must be included in the signed CSR.' },
  },
} as const;

const revokeBodySchema = {
  type: 'object',
  required: ['serialNumber'],
  additionalProperties: true,
  properties: {
    serialNumber: { type: 'string', description: 'Serial number of the certificate to revoke' },
    reason: { type: 'string', description: 'RFC 5280 revocation reason (default: unspecified)' },
  },
} as const;

// Leaf extensions we add ourselves. SAN/keyUsage/extKeyUsage come from the CSR (Cosmian
// copies the CSR's requested extensions verbatim), so we must NOT re-supply them here.
// Add CA:FALSE only when absent from the CSR; explicit CA:FALSE is preserved.
// CA:TRUE and path-length requests are rejected before issuance.
const LEAF_X509_EXTENSIONS = `[ v3_ca ]
basicConstraints=critical,CA:FALSE
`;

/**
 * Leaf extensions for the external /sign path. The CSR already carries SAN/keyUsage/EKU
 * (Cosmian copies them), so we add only basicConstraints CA:FALSE plus, when configured,
 * the issuing CA's CRL Distribution Point. CSRs never request a CDP, so no duplication.
 */
function buildLeafExtensions(caId: string, hasBasicConstraints = false): string {
  const cdp = crlDistributionUrl(caId);
  const base = hasBasicConstraints ? '[ v3_ca ]\n' : LEAF_X509_EXTENSIONS;
  return cdp ? `${base}crlDistributionPoints=URI:${cdp}\n` : base;
}

type ExternalCertType = 'server' | 'client' | 'dual';

interface ParsedCsr {
  hasBasicConstraints: boolean;
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
    | { extensions?: Array<{ name?: string; cA?: boolean; pathLenConstraint?: number; altNames?: Array<{ type: number; value?: string; ip?: string }> }> }
    | undefined;
  const exts = extReq?.extensions ?? [];
  let hasBasicConstraints = false;
  for (const ext of exts) {
    if (ext.name === 'basicConstraints') {
      if (ext.cA || ext.pathLenConstraint !== undefined) throw new Error('External enrollment cannot request a CA certificate');
      hasBasicConstraints = true;
    }
    if (ext.name === 'subjectAltName' && Array.isArray(ext.altNames)) {
      for (const an of ext.altNames) {
        // type 2=DNS, 7=IP, 1=email per RFC 5280
        if (an.type === 2 && an.value) sanDns.push(an.value);
        else if (an.type === 7 && an.ip) sanIp.push(an.ip);
        else if (an.type === 1 && an.value) sanEmail.push(an.value);
      }
    }
  }
  return { hasBasicConstraints, subjectDn, cn, sanDns, sanIp, sanEmail };
}

/**
 * External issuer API consumed by Kubernetes cert-manager, SCEP gateways and other integrations.
 * All routes require Bearer token auth scoped to a single CA via integrations.ca_id.
 *
 * Routes:
 *   GET  /api/v1/external/health            - liveness check + integration identity
 *   GET  /api/v1/external/ca-bundle         - PEM chain of integration's CA
 *   POST /api/v1/external/sign              - sign CSR (returns cert + chain)
 *   POST /api/v1/external/revoke            - revoke certificate by serial
 *
 * Idempotency: sign accepts request_uid; repeat calls return cached cert.
 *
 * Signing: the CSR is signed by the integration CA via the KMS Certify operation
 * (kms.signCertificate with preserveCsrKey). The CA private key never leaves the KMS,
 * and Cosmian signs the CSR's own public key + copies its requested extensions
 * (SAN/keyUsage/EKU). See TASK-109.22.
 */
export async function externalRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', integrationAuthPreHandler);

  // Body-schema validation failures must use the API's standard
  // {error:{code,message}} shape (Fastify's default validation error would
  // otherwise break the external issuer contract).
  fastify.setErrorHandler((error: FastifyError, _req, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: error.message } });
    }
    return reply.send(error);
  });

  // GET /health - probe used by Issuer reconciler
  fastify.get('/health', {
    schema: {
      tags: externalTag,
      security: [{ integrationToken: [] }],
      summary: 'Liveness probe returning the authenticated integration identity',
      response: { 200: externalHealthResponse },
    },
  }, async (req) => {
    return {
      status: 'ok',
      integration: req.integration!,
      // Compatibility for existing cert-manager probes.
      cluster: { id: req.integration!.id, name: req.integration!.name, caId: req.integration!.caId },
      timestamp: new Date().toISOString(),
    };
  });

  // GET /ca-bundle - PEM chain for integration's CA
  fastify.get('/ca-bundle', {
    schema: {
      tags: externalTag,
      security: [{ integrationToken: [] }],
      summary: "PEM chain of the integration's bound CA",
      // 404 is declared because the handler emits an explicit `{ error: { code, message } }`
      // 404 (its shape matches errorResponse); this GET has no body schema, so there is no
      // Fastify default-shape validation error to corrupt.
      response: { 200: externalBundleResponse, 404: errorResponse, 409: errorResponse },
    },
  }, async (req, reply) => {
    const caId = req.integration!.caId;
    const ca = await db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, caId))
      .limit(1);

    if (!ca || ca.length === 0) {
      return reply.code(404).send({ error: { code: 'CA_NOT_FOUND', message: 'CA not found' } });
    }
    // Enrollment gateways must stop using a revoked or expired issuing CA, even
    // when retrying a previously signed CSR through the idempotency path.
    if (ca[0].status !== 'active' || ca[0].notBefore > new Date() || ca[0].notAfter <= new Date()) {
      return reply.code(409).send({ error: { code: 'CA_NOT_ACTIVE', message: 'CA is not currently valid and active' } });
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

  // SCEP renewals must not authenticate with revoked or unrelated certificates.
  fastify.get<{ Params: { serial: string } }>('/certificate-status/:serial', {
    schema: {
      tags: externalTag,
      security: [{ integrationToken: [] }],
      summary: 'Check whether a service-owned certificate is active for SCEP renewal',
      params: { type: 'object', required: ['serial'], properties: { serial: { type: 'string', pattern: '^[a-fA-F0-9]{1,128}$' } } },
      response: { 200: externalStatusResponse },
    },
  }, async (req) => {
    // X.509 serial numbers are integers: tolerate case and DER sign-padding zeros.
    const serial = req.params.serial.toLowerCase().replace(/^0+/, '') || '0';
    const rows = await db.select().from(certificates).where(and(
      eq(certificates.caId, req.integration!.caId),
      eq(certificates.integrationId, req.integration!.id),
      sql`ltrim(lower(${certificates.serialNumber}), '0') = ${serial === '0' ? '' : serial}`,
    )).limit(1);
    const cert = rows[0];
    return { active: !!cert && cert.status === 'active' && cert.notBefore <= new Date() && cert.notAfter > new Date() };
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
  }>('/sign', {
    schema: {
      tags: externalTag,
      security: [{ integrationToken: [] }],
      summary: 'Sign a CSR with the integration CA (idempotent on requestUid)',
      body: signBodySchema,
      response: { 200: externalSignResponse },
    },
  }, async (req, reply) => {
    const body = req.body;
    if (!body || !body.csrPem || !body.requestUid) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'csrPem and requestUid are required' },
      });
    }

    // Idempotency: return existing cert for same requestUid scoped to integration
    const existing = await db
      .select()
      .from(certificates)
      .where(and(eq(certificates.requestUid, body.requestUid), eq(certificates.integrationId, req.integration!.id), eq(certificates.caId, req.integration!.caId)))
      .limit(1);

    if (existing.length > 0 && existing[0].integrationId === req.integration!.id) {
      if (existing[0].status !== 'active' || existing[0].notAfter <= new Date()) {
        return reply.code(409).send({ error: { code: 'CERTIFICATE_NOT_ACTIVE', message: 'The existing certificate is revoked or expired; submit a new CSR' } });
      }
      const kms = getKMSService();
      const certPem = (existing[0] as any).certificatePem
        ? (existing[0] as any).certificatePem
        : await kms.getCertificate(existing[0].kmsCertificateId, existing[0].id);
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
    // Load CA bound to this integration
    const caRows = await db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, req.integration!.caId))
      .limit(1);
    if (!caRows.length) {
      return reply.code(404).send({
        error: { code: 'CA_NOT_FOUND', message: 'CA bound to integration not found' },
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

    // Subject + SANs are taken from the CSR. The issued cert's subject == the CSR subject
    // (Cosmian signs CSRs as-is), so store the CSR subject DN. SAN columns are for
    // display/search; we record what the CSR (and thus the cert) actually contains.
    const subjectDn = parsed.subjectDn;
    // certificateType is recorded for display only — the actual keyUsage/EKU come from the
    // CSR (cert-manager encodes them), not from this hint.
    const certificateType: ExternalCertType = body.certificateType ?? 'dual';
    const durationDays = Math.min(Math.max(body.durationDays ?? 90, 1), 825);
    const sanDns = parsed.sanDns;
    const sanIp = parsed.sanIp;
    const sanEmail = parsed.sanEmail;

    const certId = randomUUID();
    const kms = getKMSService();

    let certificatePem: string;
    let certMeta: ReturnType<typeof parseCertificate>;
    let kmsCertificateId: string;
    try {
      logger.info(
        { certId, integrationId: req.integration!.id, cn: parsed.cn, caId: ca.id },
        'Signing CSR via KMS for integration'
      );

      // Sign the CSR with the integration CA via the KMS. preserveCsrKey keeps the CSR's own
      // public key; the CA private key stays in the KMS (issuer resolved from the CA's
      // KMS certificate). Cosmian copies the CSR's SAN/keyUsage/EKU; we only add CA:FALSE.
      const certInfo = await kms.signCertificate({
        csr: body.csrPem,
        issuerCertificateId: ca.kmsCertificateId,
        daysValid: durationDays,
        preserveCsrKey: true,
        x509Extensions: buildLeafExtensions(ca.id, parsed.hasBasicConstraints),
        entityId: certId,
        tags: [req.integration!.kind, `integration:${req.integration!.id}`, `ca:${ca.id}`],
      });
      kmsCertificateId = certInfo.certificateId;
      certificatePem = await kms.getCertificate(kmsCertificateId, ca.id);
      certMeta = parseCertificate(certificatePem, 'PEM');

      await db.insert(certificates).values({
        id: certId,
        caId: ca.id,
        subjectDn,
        serialNumber: certMeta.serialNumber,
        certificateType,
        notBefore: certMeta.validity.notBefore,
        notAfter: certMeta.validity.notAfter,
        kmsCertificateId,
        kmsKeyId: null, // leaf private key is generated client-side; never reaches PKI Manager/KMS
        certificatePem, // cached for fast reads (cert is also retrievable from the KMS)
        status: 'active',
        sanDns: sanDns.length ? JSON.stringify(sanDns) : null,
        sanIp: sanIp.length ? JSON.stringify(sanIp) : null,
        sanEmail: sanEmail.length ? JSON.stringify(sanEmail) : null,
        sourceType: req.integration!.kind === 'kubernetes' ? 'k8s' : req.integration!.kind === 'scep' ? 'scep' : 'integration',
        integrationId: req.integration!.id,
        k8sClusterId: req.integration!.kind === 'kubernetes' ? req.integration!.id : null,
        k8sNamespace: req.integration!.kind === 'kubernetes' ? body.k8sNamespace ?? null : null,
        k8sResource: req.integration!.kind === 'kubernetes' ? body.k8sResource ?? null : null,
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
          integrationId: req.integration!.id,
          caId: ca.id,
          requestUid: body.requestUid,
          subjectDn,
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
        { err, integrationId: req.integration!.id, requestUid: body.requestUid },
        'External /sign failed'
      );
      await db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'external.sign',
        entityType: 'integration',
        entityId: req.integration!.id,
        status: 'failure',
        details: JSON.stringify({
          requestUid: body.requestUid,
          subjectDn,
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
  }>('/revoke', {
    schema: {
      tags: externalTag,
      security: [{ integrationToken: [] }],
      summary: 'Revoke a certificate the integration issued (idempotent)',
      body: revokeBodySchema,
      response: { 200: externalRevokeResponse },
    },
  }, async (req, reply) => {
    const body = req.body;
    if (!body || !body.serialNumber) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'serialNumber is required' },
      });
    }

    const cert = await db
      .select()
      .from(certificates)
      .where(sql`ltrim(lower(${certificates.serialNumber}), '0') = ${body.serialNumber.toLowerCase().replace(/^0+/, '')}`)
      .limit(1);

    if (!cert.length) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: 'Certificate not found' },
      });
    }

    // Authorisation: integration may only revoke certs it issued
    if (cert[0].integrationId !== req.integration!.id || cert[0].caId !== req.integration!.caId) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: 'Integration cannot revoke a certificate it did not issue' },
      });
    }

    if (cert[0].status === 'revoked') {
      // Retry CRL publication too if the previous revoke persisted but publication failed.
      await getCRLService().regenerateForCa({ db, ipAddress: req.ip }, cert[0].caId);
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
        integrationId: req.integration!.id,
        serialNumber: body.serialNumber,
        reason: body.reason ?? 'unspecified',
      }),
      ipAddress: req.ip,
    } as any);

    // Keep the CA CRL current so the revoked serial appears promptly (best-effort).
    await getCRLService().regenerateForCa({ db, ipAddress: req.ip }, cert[0].caId);

    return {
      id: cert[0].id,
      serialNumber: cert[0].serialNumber,
      status: 'revoked',
      revocationDate: now.toISOString(),
    };
  });
}
