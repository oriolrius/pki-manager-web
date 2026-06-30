/**
 * Authenticated SSH REST surface (SSH-18), registered under /api/v1/ssh and
 * surfaced in the same Swagger as the X.509 routes. Validates with the same Zod
 * schemas as tRPC (single source of truth) so REST and tRPC produce identical
 * records. Honours the SSH-34 fail-closed posture.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { isOIDCEnabled } from '../../lib/oidc.js';
import {
  createSshCaSchema,
  registerHostSchema,
  issueHostCertSchema,
  issueUserCertSchema,
  createIdentitySchema,
  createPrincipalSchema,
  mapPrincipalSchema,
} from '../../trpc/ssh-schemas.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshUserService } from '../../services/ssh-user.service.js';
import { getSshPrincipalService } from '../../services/ssh-principal.service.js';
import { getSshMonService } from '../../services/ssh-mon.service.js';

class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code = 'SSH_ERROR') {
    super(message);
  }
}

function ensureSshAllowed(): void {
  if (!isOIDCEnabled() && process.env.ALLOW_UNAUTHENTICATED_SSH_CA !== 'true') {
    throw new HttpError(403, 'SSH CA/issuance requires OIDC (or ALLOW_UNAUTHENTICATED_SSH_CA=true for local dev)', 'FORBIDDEN');
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 'VALIDATION_ERROR');
  return r.data;
}

export async function sshRoutes(api: FastifyInstance): Promise<void> {
  const ctx = (req: any) => ({ db, ipAddress: req.ip ?? null });
  const tag = ['SSH Certificate Manager'];

  api.post('/cas', { schema: { tags: tag, summary: 'Create an SSH CA (User or Host)' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(createSshCaSchema, req.body);
    return getSshCaService().create(ctx(req), { caType: input.caType, label: input.label });
  });

  api.get('/cas', { schema: { tags: tag, summary: 'List SSH CAs' } }, async (req) => {
    ensureSshAllowed();
    return getSshCaService().list(ctx(req));
  });

  api.get('/trust-anchors', { schema: { tags: tag, summary: 'SSH trust anchors (TrustedUserCAKeys / @cert-authority)' } }, async (req) => {
    ensureSshAllowed();
    return getSshCaService().getTrustAnchors(ctx(req));
  });

  api.post('/hosts', { schema: { tags: tag, summary: 'Register a host by its public host key' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(registerHostSchema, req.body);
    return getSshHostService().register(ctx(req), {
      fqdn: input.fqdn,
      displayName: input.displayName,
      addresses: input.addresses ?? [],
      opensshHostPubkey: input.opensshHostPubkey,
    });
  });

  api.post('/hosts/issue', { schema: { tags: tag, summary: 'Issue a host certificate' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(issueHostCertSchema, req.body);
    return getSshHostService().issue(ctx(req), {
      hostId: input.hostId,
      caId: input.caId,
      validForSeconds: input.validForSeconds,
      keyId: input.keyId,
      serial: input.serial ? BigInt(input.serial) : undefined,
    });
  });

  api.post('/identities', { schema: { tags: tag, summary: 'Create a user identity' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(createIdentitySchema, req.body);
    return getSshUserService().createIdentity(ctx(req), {
      subject: input.subject,
      email: input.email,
      externalSubject: input.externalSubject,
    });
  });

  api.post('/users/issue', { schema: { tags: tag, summary: 'Issue a user certificate' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(issueUserCertSchema, req.body);
    return getSshUserService().issue(ctx(req), {
      identityId: input.identityId,
      caId: input.caId,
      sshPublicKey: input.sshPublicKey,
      principals: input.principals,
      extensions: input.extensions,
      forceCommand: input.forceCommand,
      sourceAddress: input.sourceAddress,
      validForSeconds: input.validForSeconds,
      keyId: input.keyId,
      enforceEntitlement: input.enforceEntitlement,
    });
  });

  // --- Principals: RBAC catalog + per-host account mapping (renders AuthorizedPrincipalsFile) ---
  api.get('/principals', { schema: { tags: tag, summary: 'List SSH principals (roles)' } }, async (req) => {
    ensureSshAllowed();
    return getSshPrincipalService().listPrincipals(ctx(req));
  });

  api.post('/principals', { schema: { tags: tag, summary: 'Create an SSH principal (role)' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(createPrincipalSchema, req.body);
    return getSshPrincipalService().createPrincipal(ctx(req), { name: input.name, description: input.description });
  });

  api.post('/principals/map', { schema: { tags: tag, summary: 'Map a principal to a local account on a host' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(mapPrincipalSchema, req.body);
    await getSshPrincipalService().mapToHost(ctx(req), {
      hostId: input.hostId,
      principalId: input.principalId,
      localAccount: input.localAccount,
    });
    return { ok: true };
  });

  api.get('/hosts/:id/auth-principals', { schema: { tags: tag, summary: "Render a host's AuthorizedPrincipalsFile contents (per local account)" } }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshPrincipalService().render(ctx(req), id);
  });

  // Machine-readable health/metrics for alerting (SSH-MON).
  api.get('/metrics', { schema: { tags: tag, summary: 'SSH cert/KRL health metrics (expiring, stale KRLs, non-pulling hosts)' } }, async (req) => {
    ensureSshAllowed();
    return getSshMonService().metrics(ctx(req));
  });

  // Translate our HttpError into the standard {error:{code,message}} shape.
  api.setErrorHandler((error: any, _req, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const status = /not found/i.test(error?.message ?? '') ? 404 : 400;
    return reply.status(status).send({ error: { code: 'SSH_ERROR', message: error?.message ?? 'SSH operation failed' } });
  });
}
