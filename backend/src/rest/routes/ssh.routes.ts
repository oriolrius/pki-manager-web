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
  importSshCaSchema,
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
  createZoneSchema,
  updateZoneSchema,
} from '../../trpc/ssh-schemas.js';
import { getSshZoneService } from '../../services/ssh-zone.service.js';
import { getSshCaService } from '../../services/ssh-ca.service.js';
import { getSshHostService } from '../../services/ssh-host.service.js';
import { getSshUserService } from '../../services/ssh-user.service.js';
import { getSshPrincipalService } from '../../services/ssh-principal.service.js';
import { getSshKrlService } from '../../services/ssh-krl.service.js';
import { getSshBulkService } from '../../services/ssh-bulk.service.js';
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

// TASK-216 bodies. These live here rather than in ssh-schemas.ts because the
// tRPC twins declare them inline too — the id half of each tRPC input travels
// in the REST path instead of the body.
const reasonSchema = z.object({ reason: z.string().max(256).optional() });
const revokeSerialSchema = z.object({ serial: z.string().regex(/^\d+$/), reason: z.string().max(256).optional() });
const revokeKeySchema = z.object({ fingerprint: z.string().min(1), reason: z.string().max(256).optional() });
const bulkRenewSchema = z.object({ certIds: z.array(z.string().min(1)).min(1) });
const bulkRevokeSchema = z.object({ certIds: z.array(z.string().min(1)).min(1), reason: z.string().max(256).optional() });

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
  /**
   * Fastify validates a declared body schema even when the request carries no
   * body at all, so a POST whose body is nothing but an optional `reason` would
   * reject a bare `curl -X POST` with "body must be object". Default the body to
   * `{}` before validation so the field stays documented but stays optional.
   */
  const optionalBody = {
    preValidation: (req: any, _reply: unknown, done: (e?: Error) => void) => {
      if (req.body === undefined || req.body === null) req.body = {};
      done();
    },
  };

  api.post('/cas', postSchema('Create an SSH CA (User or Host)', createSshCaSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(createSshCaSchema, req.body);
    return getSshCaService().create(ctx(req), { caType: input.caType, label: input.label, zone: input.zone });
  });

  api.get('/cas', listSchema('List SSH CAs (optionally filter by ?zoneId=)'), async (req) => {
    ensureSshAllowed();
    return getSshCaService().list(ctx(req), { zoneId: (req.query as any)?.zoneId });
  });

  api.get('/trust-anchors', objectSchema('SSH trust anchors (TrustedUserCAKeys / @cert-authority; ?zoneId= for one zone)'), async (req) => {
    ensureSshAllowed();
    return getSshCaService().getTrustAnchors(ctx(req), (req.query as any)?.zoneId);
  });

  // TASK-216 — CA lifecycle after create was tRPC-only, so a REST client could
  // stand a CA up but never inspect, rotate or retire it. `:caId` (not `:id`)
  // matches the existing /cas/:caId/krl routes: find-my-way rejects two
  // different param names in the same path position.
  api.get('/cas/:caId', objectSchema('Get one SSH CA'), async (req) => {
    ensureSshAllowed();
    const { caId } = req.params as { caId: string };
    return getSshCaService().get(ctx(req), caId);
  });

  api.post('/cas/import', postSchema('Import an existing KMS keypair as an SSH CA', importSshCaSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(importSshCaSchema, req.body);
    return getSshCaService().import(ctx(req), {
      caType: input.caType,
      label: input.label,
      kmsKeyId: input.kmsKeyId,
      kmsPublicKeyId: input.kmsPublicKeyId,
      zone: input.zone,
    });
  });

  api.post('/cas/:caId/revoke', { ...postSchema('Revoke an SSH CA', reasonSchema), ...optionalBody }, async (req) => {
    ensureSshAllowed();
    const { caId } = req.params as { caId: string };
    const body = parse(reasonSchema, (req.body ?? {}) as unknown);
    return getSshCaService().revoke(ctx(req), caId, body.reason);
  });

  api.post('/cas/:caId/rotate', postSchema('Rotate an SSH CA (new keypair, predecessor linked)'), async (req) => {
    ensureSshAllowed();
    const { caId } = req.params as { caId: string };
    return getSshCaService().rotate(ctx(req), caId);
  });

  api.post('/cas/:caId/retire', postSchema('Retire an SSH CA (stops issuance, keeps trust)'), async (req) => {
    ensureSshAllowed();
    const { caId } = req.params as { caId: string };
    return getSshCaService().retire(ctx(req), caId);
  });

  api.post('/hosts', postSchema('Register a host by its public host key', registerHostSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(registerHostSchema, req.body);
    return getSshHostService().register(ctx(req), {
      fqdn: input.fqdn,
      displayName: input.displayName,
      addresses: input.addresses ?? [],
      opensshHostPubkey: input.opensshHostPubkey,
      zone: input.zone,
    });
  });

  api.get('/hosts', listSchema('List hosts (optionally filter by ?fqdn= and/or ?zoneId=)'), async (req) => {
    ensureSshAllowed();
    const hosts = await getSshHostService().list(ctx(req), { zoneId: (req.query as any)?.zoneId });
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

  // TASK-216 — host lifecycle twins. Declared AFTER /hosts/issue so the literal
  // path is matched before the `:id` parameter.
  api.get('/hosts/:id', objectSchema('Get one host'), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshHostService().get(ctx(req), id);
  });

  api.get('/hosts/:id/deploy-bundle', objectSchema("Build the host's deploy bundle (sshd drop-in, CA keys, on-host paths)"), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshHostService().buildHostDeployBundle(ctx(req), id);
  });

  api.post('/hosts/:id/revoke', { ...postSchema("Revoke the host's current certificate", reasonSchema), ...optionalBody }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    const body = parse(reasonSchema, (req.body ?? {}) as unknown);
    await getSshHostService().revokeCurrent(ctx(req), id, body.reason);
    return { ok: true };
  });

  api.post('/hosts/:id/ecies-key', postSchema("Register the host's ECDSA public key as its ECIES/KRL recipient"), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshHostService().registerEciesKey(ctx(req), id);
  });

  api.post('/hosts/:id/offboard', { ...postSchema('Offboard a host (terminal: retires its per-host KRL lineage)', reasonSchema), ...optionalBody }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    const body = parse(reasonSchema, (req.body ?? {}) as unknown);
    await getSshHostService().offboard(ctx(req), id, body.reason);
    return { ok: true };
  });

  api.post('/identities', postSchema('Create a user identity', createIdentitySchema), async (req) => {
    ensureSshAllowed();
    const input = parse(createIdentitySchema, req.body);
    return getSshUserService().createIdentity(ctx(req), {
      subject: input.subject,
      email: input.email,
      externalSubject: input.externalSubject,
      zone: input.zone,
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

  // TASK-216 — identity twins. Listing identities was tRPC-only, which is why a
  // REST client could not check whether a subject already existed before
  // creating one (ssh_identities.subject is UNIQUE).
  api.get('/identities', listSchema('List user identities (optionally filter by ?zoneId=)'), async (req) => {
    ensureSshAllowed();
    return getSshUserService().listIdentities(ctx(req), { zoneId: (req.query as any)?.zoneId });
  });

  api.post('/identities/:id/disable', postSchema('Disable an identity (blocks further issuance)'), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    await getSshUserService().disableIdentity(ctx(req), id);
    return { ok: true };
  });

  api.post('/identities/:id/offboard', { ...postSchema("Offboard an identity (disable + revoke its live certs)", reasonSchema), ...optionalBody }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    const body = parse(reasonSchema, (req.body ?? {}) as unknown);
    await getSshUserService().offboard(ctx(req), id, body.reason);
    return { ok: true };
  });

  api.get('/users/certificates', listSchema('List user certificates (optionally filter by ?identityId=)'), async (req) => {
    ensureSshAllowed();
    const identityId = (req.query as any)?.identityId as string | undefined;
    return getSshUserService().listCertificates(ctx(req), identityId);
  });

  // --- Principals: RBAC catalog + per-host account mapping (renders AuthorizedPrincipalsFile) ---
  api.get('/principals', listSchema('List SSH principals (roles; optionally filter by ?zoneId=)'), async (req) => {
    ensureSshAllowed();
    return getSshPrincipalService().listPrincipals(ctx(req), { zoneId: (req.query as any)?.zoneId });
  });

  api.post('/principals', postSchema('Create an SSH principal (role)', createPrincipalSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(createPrincipalSchema, req.body);
    return getSshPrincipalService().createPrincipal(ctx(req), { name: input.name, description: input.description, zone: input.zone });
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

  // TASK-216 — principal twins. `/principals/mappings` and `/principals/stale-hosts`
  // are declared before `DELETE /principals/:id` only for readability; the
  // methods differ, so ordering is not load-bearing here.
  api.get('/principals/mappings', objectSchema('List principal -> (host, local account) mappings across the fleet'), async (req) => {
    ensureSshAllowed();
    return getSshPrincipalService().mappingsByPrincipal(ctx(req));
  });

  api.get('/principals/stale-hosts', listSchema('Hosts whose principal maps changed after the last push'), async (req) => {
    ensureSshAllowed();
    return getSshPrincipalService().staleHosts(ctx(req));
  });

  api.delete('/principals/:id', { schema: { tags: tag, summary: 'Delete a principal (rejected while entitlements or host maps reference it)', response: { 200: okObjectResponse, ...errResponses } } }, async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    await getSshPrincipalService().deletePrincipal(ctx(req), id);
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
      zone: input.zone,
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

  // TASK-215: the counterpart to the GET above — clears the Stale flag once the
  // rendered files are on the host. Previously tRPC-only, which forced a
  // REST-driven onboarding to break out of /api/v1 for this one step.
  api.post('/hosts/:id/auth-principals/pushed', postSchema("Mark a host's rendered principal files as pushed (clears Stale)"), async (req) => {
    ensureSshAllowed();
    const { id } = req.params as { id: string };
    return getSshPrincipalService().markPushed(ctx(req), id);
  });

  // --- Revocation / KRL. A server's RevokedKeys consumes the (User) CA's KRL. ---
  api.post('/certs/:id/revoke', { ...postSchema('Revoke an SSH certificate (rebuilds the CA KRL)', reasonSchema), ...optionalBody }, async (req) => {
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

  // TASK-216 — revoke without holding a cert row: by serial, or by public-key
  // fingerprint. The fingerprint form is the only way to revoke a key this PKI
  // never issued (e.g. a leaked key pasted into authorized_keys).
  api.post('/cas/:caId/revoke-serial', postSchema('Revoke a serial under a CA (rebuilds the KRL)', revokeSerialSchema), async (req) => {
    ensureSshAllowed();
    const { caId } = req.params as { caId: string };
    const body = parse(revokeSerialSchema, req.body);
    return getSshKrlService().revokeBySerial(ctx(req), caId, body.serial, body.reason);
  });

  api.post('/cas/:caId/revoke-key', postSchema('Revoke a public key by fingerprint under a CA (rebuilds the KRL)', revokeKeySchema), async (req) => {
    ensureSshAllowed();
    const { caId } = req.params as { caId: string };
    const body = parse(revokeKeySchema, req.body);
    return getSshKrlService().revokeByKeyFingerprint(ctx(req), caId, body.fingerprint, body.reason);
  });

  // --- Bulk lifecycle (the whole bulk router was tRPC-only) ---
  api.get('/bulk/expiring', listSchema('Certificates expiring within ?withinSeconds='), async (req) => {
    ensureSshAllowed();
    const raw = (req.query as any)?.withinSeconds;
    const { withinSeconds } = parse(z.object({ withinSeconds: z.coerce.number().int().positive() }), { withinSeconds: raw });
    return getSshBulkService().expiring(ctx(req), withinSeconds);
  });

  api.post('/bulk/renew', postSchema('Renew many certificates by id', bulkRenewSchema), async (req) => {
    ensureSshAllowed();
    const body = parse(bulkRenewSchema, req.body);
    return getSshBulkService().bulkRenew(ctx(req), body.certIds);
  });

  api.post('/bulk/revoke', postSchema('Revoke many certificates by id', bulkRevokeSchema), async (req) => {
    ensureSshAllowed();
    const body = parse(bulkRevokeSchema, req.body);
    return getSshBulkService().bulkRevoke(ctx(req), body.certIds, body.reason);
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

  api.get('/metrics', objectSchema('SSH cert/KRL health metrics (expiring, stale KRLs, non-pulling hosts; ?zoneId= to scope)'), async (req) => {
    ensureSshAllowed();
    return getSshMonService().metrics(ctx(req), { zoneId: (req.query as any)?.zoneId });
  });

  // ---- Zones (decision-017 §7). CRUD over the trust-boundary grouping. ----
  api.get('/zones', listSchema('List zones (?includeArchived=true to include archived)'), async (req) => {
    ensureSshAllowed();
    const includeArchived = (req.query as any)?.includeArchived === 'true' || (req.query as any)?.includeArchived === true;
    return getSshZoneService().list(ctx(req), { includeArchived });
  });

  api.post('/zones', postSchema('Create a zone', createZoneSchema), async (req) => {
    ensureSshAllowed();
    const input = parse(createZoneSchema, req.body);
    return getSshZoneService().create(ctx(req), input);
  });

  api.get('/zones/:ref', objectSchema('Get one zone by id or slug'), async (req) => {
    ensureSshAllowed();
    const { ref } = req.params as { ref: string };
    return getSshZoneService().get(ctx(req), ref);
  });

  api.post('/zones/:ref', postSchema('Update a zone (display name / description; slug is immutable)', updateZoneSchema.omit({ ref: true })), async (req) => {
    ensureSshAllowed();
    const { ref } = req.params as { ref: string };
    const input = parse(updateZoneSchema.omit({ ref: true }), req.body);
    return getSshZoneService().update(ctx(req), ref, input);
  });

  api.post('/zones/:ref/archive', { ...postSchema('Archive a zone (blocks new entities/issuance; keeps serving existing trust material)'), ...optionalBody }, async (req) => {
    ensureSshAllowed();
    const { ref } = req.params as { ref: string };
    return getSshZoneService().archive(ctx(req), ref);
  });

  api.post('/zones/:ref/unarchive', { ...postSchema('Reactivate an archived zone'), ...optionalBody }, async (req) => {
    ensureSshAllowed();
    const { ref } = req.params as { ref: string };
    return getSshZoneService().unarchive(ctx(req), ref);
  });

  // Translate our HttpError into the standard {error:{code,message}} shape.
  api.setErrorHandler((error: any, _req, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    // Typed service errors carry their class name; a "…ExistsError" is a 409
    // conflict, a "…not found" is 404, everything else a 400 bad request.
    const name = error?.name ?? '';
    const status = /ExistsError$/.test(name)
      ? 409
      : /not found/i.test(error?.message ?? '')
        ? 404
        : 400;
    return reply.status(status).send({ error: { code: 'SSH_ERROR', message: error?.message ?? 'SSH operation failed' } });
  });
}
