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
  grantPrincipalSchema,
  mapPrincipalSchema,
  blockHostSchema,
  unblockHostSchema,
  mintTokenSchema,
} from '../../trpc/ssh-schemas.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshUserService } from '../../services/ssh-user.service.js';
import { getSshPrincipalService } from '../../services/ssh-principal.service.js';
import { getSshKrlService } from '../../services/ssh-krl.service.js';
import { getSshBlockService } from '../../services/ssh-block.service.js';
import { getSshFleetTokenService } from '../../services/ssh-fleet-token.service.js';
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

  api.get('/hosts', { schema: { tags: tag, summary: 'List hosts (optionally filter by ?fqdn=)' } }, async (req) => {
    ensureSshAllowed();
    const hosts = await getSshHostService().list(ctx(req));
    const fqdn = (req.query as any)?.fqdn as string | undefined;
    return fqdn ? hosts.filter((h) => h.fqdn === fqdn) : hosts;
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

  api.post('/principals/grant', { schema: { tags: tag, summary: 'Grant an identity the entitlement to encode a principal' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(grantPrincipalSchema, req.body);
    await getSshPrincipalService().grantToIdentity(ctx(req), { identityId: input.identityId, principalId: input.principalId });
    return { ok: true };
  });

  // --- Fleet tokens: automation credentials for the external SSH API ---
  api.post('/tokens', { schema: { tags: tag, summary: 'Mint a fleet token (plaintext shown once)' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(mintTokenSchema, req.body);
    return getSshFleetTokenService().mint(ctx(req), {
      name: input.name,
      userCaId: input.userCaId,
      hostCaId: input.hostCaId,
      opSet: input.opSet,
    });
  });

  api.get('/tokens', { schema: { tags: tag, summary: 'List fleet tokens (metadata only, no secrets)' } }, async (req) => {
    ensureSshAllowed();
    return getSshFleetTokenService().list(ctx(req));
  });

  api.post('/tokens/:id/revoke', { schema: { tags: tag, summary: 'Revoke a fleet token' } }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    await getSshFleetTokenService().revoke(ctx(req), id);
    return { ok: true };
  });

  api.get('/hosts/:id/auth-principals', { schema: { tags: tag, summary: "Render a host's AuthorizedPrincipalsFile contents (per local account)" } }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshPrincipalService().render(ctx(req), id);
  });

  // --- Revocation / KRL. A server's RevokedKeys consumes the (User) CA's KRL. ---
  api.post('/certs/:id/revoke', { schema: { tags: tag, summary: 'Revoke an SSH certificate (rebuilds the CA KRL)' } }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    const body = parse(z.object({ reason: z.string().max(256).optional() }), (req.body ?? {}) as unknown);
    return getSshKrlService().revokeByCert(ctx(req), id, body.reason);
  });

  api.post('/cas/:caId/krl', { schema: { tags: tag, summary: 'Generate / rebuild the KRL for a CA' } }, async (req) => {
    ensureSshAllowed();
    const { caId } = req.params as { caId: string };
    return getSshKrlService().generate(ctx(req), caId);
  });

  api.get('/cas/:caId/revocations', { schema: { tags: tag, summary: 'List revocations for a CA' } }, async (req) => {
    ensureSshAllowed();
    const { caId } = req.params as { caId: string };
    return getSshKrlService().listRevocations(ctx(req), caId);
  });

  // The bare KRL bytes — the RevokedKeys file a server fetches. Lazily (re)builds
  // when missing/stale; serves last-good on signing failure.
  api.get('/cas/:caId/krl.bin', { schema: { tags: tag, summary: 'Download the bare KRL bytes (RevokedKeys file)' } }, async (req, reply) => {
    ensureSshAllowed();
    const { caId } = req.params as { caId: string };
    const svc = getSshKrlService();
    let row = await svc.getLatestRow(ctx(req), caId);
    if (!row || new Date(row.nextUpdate).getTime() < Date.now()) {
      try {
        await svc.generate(ctx(req), caId);
        row = await svc.getLatestRow(ctx(req), caId);
      } catch {
        /* signing unavailable: fall back to last-good bytes if we have them */
      }
    }
    if (!row) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'no KRL for this CA' } });
    }
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', 'attachment; filename="revoked_keys"');
    reply.header('ETag', row.versionHash);
    return reply.send(Buffer.from(row.krlBlob));
  });

  // Machine-readable health/metrics for alerting (SSH-MON).
  // ── Per-host user access blocks (BLK-08, decision-016) — tRPC twins ───────
  // Actor attribution parity with tRPC: the OIDC subject (when present) is the
  // audit-visible createdBy/liftedBy, not the caller IP.
  const actorOf = (req: any): string | undefined =>
    req.user?.preferredUsername ?? req.user?.email ?? req.user?.sub ?? undefined;

  api.post('/blocks', { schema: { tags: tag, summary: 'Block an identity on a host (per-host KRL deny; certs stay valid elsewhere)' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(blockHostSchema, req.body);
    return getSshBlockService().block(ctx(req), {
      hostId: input.hostId,
      identityId: input.identityId,
      reason: input.reason,
      createdBy: actorOf(req),
    });
  });

  api.post('/blocks/unblock', { schema: { tags: tag, summary: 'Lift a block (symmetric: enforced on the next host pull)' } }, async (req) => {
    ensureSshAllowed();
    const input = parse(unblockHostSchema, req.body);
    return getSshBlockService().unblock(ctx(req), {
      hostId: input.hostId,
      identityId: input.identityId,
      liftedBy: actorOf(req),
    });
  });

  api.get('/hosts/:id/access', { schema: { tags: tag, summary: 'Who can reach this host (entitlements + blocks + distribution state)' } }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshBlockService().hostAccess(ctx(req), id);
  });

  api.get('/hosts/:id/blocks', { schema: { tags: tag, summary: 'Block history for a host (active + lifted, audit-retained)' } }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshBlockService().listForHost(ctx(req), id);
  });

  api.get('/identities/:id/blocks', { schema: { tags: tag, summary: "An identity's active blocks with per-host distribution state" } }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshBlockService().listForIdentityWithState(ctx(req), id);
  });

  api.get('/identities/:id/collisions', { schema: { tags: tag, summary: 'Identities sharing a certified public key with this one (over-block pre-check)' } }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshBlockService().sharedKeyCollisions(ctx(req), id);
  });

  api.get('/blocks/fleet', { schema: { tags: tag, summary: 'Fleet-wide per-host block counts + KRL distribution state' } }, async (req) => {
    ensureSshAllowed();
    return getSshBlockService().fleetDistribution(ctx(req));
  });

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
