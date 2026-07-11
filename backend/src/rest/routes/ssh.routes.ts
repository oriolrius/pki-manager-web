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
import {
  zodBodySchema,
  okObjectResponse,
  okArrayResponse,
  errorResponse,
} from '../schemas/ssh-openapi-schemas.js';

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

  // Schema builders (TASK-207): document requestBody + response so @fastify/swagger emits
  // typed models. Bodies come from the same Zod schemas tRPC uses; responses are permissive
  // (see ssh-openapi-schemas.ts). The 400/500 error responses match this router's
  // setErrorHandler, which normalises every error to `{ error: { code, message } }`.
  const errResponses = { 400: errorResponse, 500: errorResponse };
  /** POST: `body` (from Zod, when present) + permissive object 200 response. */
  const postSchema = (summary: string, body?: z.ZodTypeAny, response: unknown = okObjectResponse) => ({
    schema: {
      tags: tag,
      summary,
      ...(body ? { body: zodBodySchema(body) } : {}),
      response: { 200: response, ...errResponses },
    },
  });
  /** GET list endpoint: permissive array-of-objects 200 response. */
  const listSchema = (summary: string) => ({
    schema: { tags: tag, summary, response: { 200: okArrayResponse, ...errResponses } },
  });
  /** GET object endpoint: permissive object 200 response. */
  const objectSchema = (summary: string) => ({
    schema: { tags: tag, summary, response: { 200: okObjectResponse, ...errResponses } },
  });

  api.post('/cas', postSchema('Create an SSH CA (User or Host)', createSshCaSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(createSshCaSchema, req.body);
    return getSshCaService().create(ctx(req), { caType: input.caType, label: input.label });
  });

  api.get('/cas', listSchema('List SSH CAs'), async (req) => {
    ensureSshAllowed();
    return getSshCaService().list(ctx(req));
  });

  api.get('/trust-anchors', objectSchema('SSH trust anchors (TrustedUserCAKeys / @cert-authority)'), async (req) => {
    ensureSshAllowed();
    return getSshCaService().getTrustAnchors(ctx(req));
  });

  api.post('/hosts', postSchema('Register a host by its public host key', registerHostSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(registerHostSchema, req.body);
    return getSshHostService().register(ctx(req), {
      fqdn: input.fqdn,
      displayName: input.displayName,
      addresses: input.addresses ?? [],
      opensshHostPubkey: input.opensshHostPubkey,
    });
  });

  api.get('/hosts', listSchema('List hosts (optionally filter by ?fqdn=)'), async (req) => {
    ensureSshAllowed();
    const hosts = await getSshHostService().list(ctx(req));
    const fqdn = (req.query as any)?.fqdn as string | undefined;
    return fqdn ? hosts.filter((h) => h.fqdn === fqdn) : hosts;
  });

  api.post('/hosts/issue', postSchema('Issue a host certificate', issueHostCertSchema), async (req) => {
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

  api.post('/identities', postSchema('Create a user identity', createIdentitySchema), async (req) => {
    ensureSshAllowed();
    const input = parse(createIdentitySchema, req.body);
    return getSshUserService().createIdentity(ctx(req), {
      subject: input.subject,
      email: input.email,
      externalSubject: input.externalSubject,
    });
  });

  api.post('/users/issue', postSchema('Issue a user certificate', issueUserCertSchema), async (req) => {
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
  api.get('/principals', listSchema('List SSH principals (roles)'), async (req) => {
    ensureSshAllowed();
    return getSshPrincipalService().listPrincipals(ctx(req));
  });

  api.post('/principals', postSchema('Create an SSH principal (role)', createPrincipalSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(createPrincipalSchema, req.body);
    return getSshPrincipalService().createPrincipal(ctx(req), { name: input.name, description: input.description });
  });

  api.post('/principals/map', postSchema('Map a principal to a local account on a host', mapPrincipalSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(mapPrincipalSchema, req.body);
    await getSshPrincipalService().mapToHost(ctx(req), {
      hostId: input.hostId,
      principalId: input.principalId,
      localAccount: input.localAccount,
    });
    return { ok: true };
  });

  api.post('/principals/grant', postSchema('Grant an identity the entitlement to encode a principal', grantPrincipalSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(grantPrincipalSchema, req.body);
    await getSshPrincipalService().grantToIdentity(ctx(req), { identityId: input.identityId, principalId: input.principalId });
    return { ok: true };
  });

  // --- Fleet tokens: automation credentials for the external SSH API ---
  api.post('/tokens', postSchema('Mint a fleet token (plaintext shown once)', mintTokenSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(mintTokenSchema, req.body);
    return getSshFleetTokenService().mint(ctx(req), {
      name: input.name,
      userCaId: input.userCaId,
      hostCaId: input.hostCaId,
      opSet: input.opSet,
    });
  });

  api.get('/tokens', listSchema('List fleet tokens (metadata only, no secrets)'), async (req) => {
    ensureSshAllowed();
    return getSshFleetTokenService().list(ctx(req));
  });

  api.post('/tokens/:id/revoke', postSchema('Revoke a fleet token'), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    await getSshFleetTokenService().revoke(ctx(req), id);
    return { ok: true };
  });

  api.get('/hosts/:id/auth-principals', objectSchema("Render a host's AuthorizedPrincipalsFile contents (per local account)"), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshPrincipalService().render(ctx(req), id);
  });

  // --- Revocation / KRL. A server's RevokedKeys consumes the (User) CA's KRL. ---
  api.post('/certs/:id/revoke', postSchema('Revoke an SSH certificate (rebuilds the CA KRL)', z.object({ reason: z.string().max(256).optional() })), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    const body = parse(z.object({ reason: z.string().max(256).optional() }), (req.body ?? {}) as unknown);
    return getSshKrlService().revokeByCert(ctx(req), id, body.reason);
  });

  api.post('/cas/:caId/krl', postSchema('Generate / rebuild the KRL for a CA'), async (req) => {
    ensureSshAllowed();
    const { caId } = req.params as { caId: string };
    return getSshKrlService().generate(ctx(req), caId);
  });

  api.get('/cas/:caId/revocations', listSchema('List revocations for a CA'), async (req) => {
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

  api.post('/blocks', postSchema('Block an identity on a host (per-host KRL deny; certs stay valid elsewhere)', blockHostSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(blockHostSchema, req.body);
    return getSshBlockService().block(ctx(req), {
      hostId: input.hostId,
      identityId: input.identityId,
      reason: input.reason,
      createdBy: actorOf(req),
    });
  });

  api.post('/blocks/unblock', postSchema('Lift a block (symmetric: enforced on the next host pull)', unblockHostSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(unblockHostSchema, req.body);
    return getSshBlockService().unblock(ctx(req), {
      hostId: input.hostId,
      identityId: input.identityId,
      liftedBy: actorOf(req),
    });
  });

  api.get('/hosts/:id/access', objectSchema('Who can reach this host (entitlements + blocks + distribution state)'), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshBlockService().hostAccess(ctx(req), id);
  });

  api.get('/hosts/:id/blocks', listSchema('Block history for a host (active + lifted, audit-retained)'), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshBlockService().listForHost(ctx(req), id);
  });

  api.get('/identities/:id/blocks', listSchema("An identity's active blocks with per-host distribution state"), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshBlockService().listForIdentityWithState(ctx(req), id);
  });

  api.get('/identities/:id/collisions', listSchema('Identities sharing a certified public key with this one (over-block pre-check)'), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshBlockService().sharedKeyCollisions(ctx(req), id);
  });

  api.get('/blocks/fleet', listSchema('Fleet-wide per-host block counts + KRL distribution state'), async (req) => {
    ensureSshAllowed();
    return getSshBlockService().fleetDistribution(ctx(req));
  });

  api.get('/metrics', objectSchema('SSH cert/KRL health metrics (expiring, stale KRLs, non-pulling hosts)'), async (req) => {
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
