/**
 * SSH Certificate Manager tRPC router (SSH-17). Mirrors procedures/crl.ts:
 * Zod input from ssh-schemas.ts, services get { db, ipAddress }, typed service
 * errors map to TRPCError codes. CA management uses sshAdminProcedure (admin +
 * fail-closed when OIDC off, SSH-34); issuance/reads use sshProtectedProcedure.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, sshAdminProcedure, sshProtectedProcedure } from '../init.js';
import {
  createSshCaSchema,
  importSshCaSchema,
  sshCaIdSchema,
  registerHostSchema,
  issueHostCertSchema,
  hostIdSchema,
  createIdentitySchema,
  identityIdSchema,
  issueUserCertSchema,
  createPrincipalSchema,
  grantPrincipalSchema,
  mapPrincipalSchema,
  revokeSshCertSchema,
  renderPrincipalsSchema,
  blockHostSchema,
  unblockHostSchema,
  mintTokenSchema,
  createZoneSchema,
  updateZoneSchema,
  zoneRefInputSchema,
  listZonesSchema,
  zoneFilterSchema,
} from '../ssh-schemas.js';
import {
  getSshZoneService,
  SshZoneNotFoundError,
  SshZoneAmbiguousError,
  SshZoneExistsError,
  SshZoneSlugError,
  SshZoneArchivedError,
} from '../../services/ssh-zone.service.js';
import { getSshCaService, SshCaExistsError, SshCaAlgorithmError, SshCaNotFoundError } from '../../services/ssh-ca.service.js';
import { getSshHostService, SshHostError } from '../../services/ssh-host.service.js';
import { getSshUserService, SshUserError } from '../../services/ssh-user.service.js';
import { getSshPrincipalService, SshPrincipalError } from '../../services/ssh-principal.service.js';
import { getSshFleetTokenService, SshTokenError } from '../../services/ssh-fleet-token.service.js';
import { getSshBulkService } from '../../services/ssh-bulk.service.js';
import { getSshKrlService, SshKrlError } from '../../services/ssh-krl.service.js';
import { getSshBlockService, SshBlockError } from '../../services/ssh-block.service.js';
import { getSshMonService } from '../../services/ssh-mon.service.js';
import {
  SshSignCaNotFoundError,
  SshCaUnusableError,
  SshCertTypeMismatchError,
} from '../../services/ssh-cert.service.js';

function mapSshError(error: unknown): never {
  if (error instanceof SshCaExistsError || error instanceof SshZoneExistsError)
    throw new TRPCError({ code: 'CONFLICT', message: error.message });
  if (error instanceof SshZoneNotFoundError)
    throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
  if (error instanceof SshZoneAmbiguousError || error instanceof SshZoneSlugError || error instanceof SshZoneArchivedError)
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  if (error instanceof SshCaNotFoundError || error instanceof SshSignCaNotFoundError)
    throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
  if (error instanceof SshCaAlgorithmError || error instanceof SshCaUnusableError || error instanceof SshCertTypeMismatchError)
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  if (error instanceof SshHostError || error instanceof SshUserError || error instanceof SshPrincipalError || error instanceof SshTokenError || error instanceof SshKrlError || error instanceof SshBlockError) {
    const code = /not found/i.test(error.message) ? 'NOT_FOUND' : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.message });
  }
  throw error;
}

const svcCtx = (ctx: any) => ({ db: ctx.db, ipAddress: ctx.req?.ip ?? null });

// Zone management (decision-017 §7). CRUD is admin-tier like CA management;
// reads are protected. resolveZone is fail-closed — see ssh-zone.service.
const zoneRouter = router({
  list: sshProtectedProcedure.input(listZonesSchema).query(async ({ ctx, input }) =>
    getSshZoneService().list(svcCtx(ctx), { includeArchived: input?.includeArchived })
  ),
  get: sshProtectedProcedure.input(zoneRefInputSchema).query(async ({ ctx, input }) => {
    try {
      return await getSshZoneService().get(svcCtx(ctx), input.ref);
    } catch (e) {
      mapSshError(e);
    }
  }),
  create: sshAdminProcedure.input(createZoneSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshZoneService().create(svcCtx(ctx), input);
    } catch (e) {
      mapSshError(e);
    }
  }),
  update: sshAdminProcedure.input(updateZoneSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshZoneService().update(svcCtx(ctx), input.ref, {
        displayName: input.displayName,
        description: input.description,
      });
    } catch (e) {
      mapSshError(e);
    }
  }),
  archive: sshAdminProcedure.input(zoneRefInputSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshZoneService().archive(svcCtx(ctx), input.ref);
    } catch (e) {
      mapSshError(e);
    }
  }),
  unarchive: sshAdminProcedure.input(zoneRefInputSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshZoneService().unarchive(svcCtx(ctx), input.ref);
    } catch (e) {
      mapSshError(e);
    }
  }),
});

const caRouter = router({
  list: sshProtectedProcedure.input(zoneFilterSchema).query(async ({ ctx, input }) =>
    getSshCaService().list(svcCtx(ctx), { zoneId: input?.zoneId })
  ),
  get: sshProtectedProcedure.input(sshCaIdSchema).query(async ({ ctx, input }) => {
    try {
      return await getSshCaService().get(svcCtx(ctx), input.id);
    } catch (e) {
      mapSshError(e);
    }
  }),
  trustAnchors: sshProtectedProcedure.input(zoneFilterSchema).query(async ({ ctx, input }) => {
    try {
      return await getSshCaService().getTrustAnchors(svcCtx(ctx), input?.zoneId);
    } catch (e) {
      mapSshError(e);
    }
  }),
  create: sshAdminProcedure.input(createSshCaSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshCaService().create(svcCtx(ctx), { caType: input.caType, label: input.label, zone: input.zone });
    } catch (e) {
      mapSshError(e);
    }
  }),
  import: sshAdminProcedure.input(importSshCaSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshCaService().import(svcCtx(ctx), {
        caType: input.caType,
        label: input.label,
        kmsKeyId: input.kmsKeyId,
        kmsPublicKeyId: input.kmsPublicKeyId,
        zone: input.zone,
      });
    } catch (e) {
      mapSshError(e);
    }
  }),
  revoke: sshAdminProcedure.input(sshCaIdSchema.extend({ reason: z.string().max(256).optional() })).mutation(async ({ ctx, input }) => {
    try {
      return await getSshCaService().revoke(svcCtx(ctx), input.id, input.reason);
    } catch (e) {
      mapSshError(e);
    }
  }),
  rotate: sshAdminProcedure.input(sshCaIdSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshCaService().rotate(svcCtx(ctx), input.id);
    } catch (e) {
      mapSshError(e);
    }
  }),
  retire: sshAdminProcedure.input(sshCaIdSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshCaService().retire(svcCtx(ctx), input.id);
    } catch (e) {
      mapSshError(e);
    }
  }),
});

const hostRouter = router({
  list: sshProtectedProcedure.input(zoneFilterSchema).query(async ({ ctx, input }) =>
    getSshHostService().list(svcCtx(ctx), { zoneId: input?.zoneId })
  ),
  // BLK-08 read model: who can reach this host (entitlement join + blocks + state).
  access: sshProtectedProcedure.input(hostIdSchema).query(async ({ ctx, input }) => {
    try {
      const { getSshBlockService } = await import('../../services/ssh-block.service.js');
      return await getSshBlockService().hostAccess(svcCtx(ctx), input.id);
    } catch (e) {
      mapSshError(e);
    }
  }),
  get: sshProtectedProcedure.input(hostIdSchema).query(async ({ ctx, input }) => {
    try {
      return await getSshHostService().get(svcCtx(ctx), input.id);
    } catch (e) {
      mapSshError(e);
    }
  }),
  register: sshProtectedProcedure.input(registerHostSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshHostService().register(svcCtx(ctx), {
        fqdn: input.fqdn,
        displayName: input.displayName,
        addresses: input.addresses,
        opensshHostPubkey: input.opensshHostPubkey,
        zone: input.zone,
      });
    } catch (e) {
      mapSshError(e);
    }
  }),
  deployBundle: sshProtectedProcedure.input(hostIdSchema).query(async ({ ctx, input }) => {
    try {
      return await getSshHostService().buildHostDeployBundle(svcCtx(ctx), input.id);
    } catch (e) {
      mapSshError(e);
    }
  }),
  issue: sshProtectedProcedure.input(issueHostCertSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshHostService().issue(svcCtx(ctx), {
        hostId: input.hostId,
        caId: input.caId,
        validForSeconds: input.validForSeconds,
        keyId: input.keyId,
        serial: input.serial ? BigInt(input.serial) : undefined,
      });
    } catch (e) {
      mapSshError(e);
    }
  }),
  revoke: sshProtectedProcedure.input(hostIdSchema.extend({ reason: z.string().max(256).optional() })).mutation(async ({ ctx, input }) => {
    try {
      await getSshHostService().revokeCurrent(svcCtx(ctx), input.id, input.reason);
      return { ok: true };
    } catch (e) {
      mapSshError(e);
    }
  }),
  registerEciesKey: sshProtectedProcedure.input(hostIdSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshHostService().registerEciesKey(svcCtx(ctx), input.id);
    } catch (e) {
      mapSshError(e);
    }
  }),
  offboard: sshProtectedProcedure.input(hostIdSchema.extend({ reason: z.string().max(256).optional() })).mutation(async ({ ctx, input }) => {
    try {
      await getSshHostService().offboard(svcCtx(ctx), input.id, input.reason);
      return { ok: true };
    } catch (e) {
      mapSshError(e);
    }
  }),
});

const userRouter = router({
  listIdentities: sshProtectedProcedure.input(zoneFilterSchema).query(async ({ ctx, input }) =>
    getSshUserService().listIdentities(svcCtx(ctx), { zoneId: input?.zoneId })
  ),
  createIdentity: sshProtectedProcedure.input(createIdentitySchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshUserService().createIdentity(svcCtx(ctx), {
        subject: input.subject,
        email: input.email,
        externalSubject: input.externalSubject,
        zone: input.zone,
      });
    } catch (e) {
      mapSshError(e);
    }
  }),
  disableIdentity: sshProtectedProcedure.input(identityIdSchema).mutation(async ({ ctx, input }) => {
    try {
      await getSshUserService().disableIdentity(svcCtx(ctx), input.id);
      return { ok: true };
    } catch (e) {
      mapSshError(e);
    }
  }),
  offboard: sshProtectedProcedure.input(identityIdSchema.extend({ reason: z.string().max(256).optional() })).mutation(async ({ ctx, input }) => {
    try {
      await getSshUserService().offboard(svcCtx(ctx), input.id, input.reason);
      return { ok: true };
    } catch (e) {
      mapSshError(e);
    }
  }),
  issue: sshProtectedProcedure.input(issueUserCertSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshUserService().issue(svcCtx(ctx), {
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
    } catch (e) {
      mapSshError(e);
    }
  }),
  listCertificates: sshProtectedProcedure.input(z.object({ identityId: z.string().optional() })).query(async ({ ctx, input }) =>
    getSshUserService().listCertificates(svcCtx(ctx), input.identityId)
  ),
  revoke: sshProtectedProcedure.input(revokeSshCertSchema).mutation(async ({ ctx, input }) => {
    try {
      await getSshUserService().revoke(svcCtx(ctx), input.certId, input.reason);
      return { ok: true };
    } catch (e) {
      mapSshError(e);
    }
  }),
});

const principalRouter = router({
  list: sshProtectedProcedure.input(zoneFilterSchema).query(async ({ ctx, input }) =>
    getSshPrincipalService().listPrincipals(svcCtx(ctx), { zoneId: input?.zoneId })
  ),
  mappingsByPrincipal: sshProtectedProcedure.query(async ({ ctx }) => getSshPrincipalService().mappingsByPrincipal(svcCtx(ctx))),
  create: sshProtectedProcedure.input(createPrincipalSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshPrincipalService().createPrincipal(svcCtx(ctx), { name: input.name, description: input.description, zone: input.zone });
    } catch (e) {
      mapSshError(e);
    }
  }),
  delete: sshProtectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    try {
      await getSshPrincipalService().deletePrincipal(svcCtx(ctx), input.id);
      return { ok: true };
    } catch (e) {
      mapSshError(e);
    }
  }),
  grant: sshProtectedProcedure.input(grantPrincipalSchema).mutation(async ({ ctx, input }) => {
    await getSshPrincipalService().grantToIdentity(svcCtx(ctx), { identityId: input.identityId, principalId: input.principalId });
    return { ok: true };
  }),
  map: sshProtectedProcedure.input(mapPrincipalSchema).mutation(async ({ ctx, input }) => {
    try {
      await getSshPrincipalService().mapToHost(svcCtx(ctx), {
        hostId: input.hostId,
        principalId: input.principalId,
        localAccount: input.localAccount,
      });
      return { ok: true };
    } catch (e) {
      mapSshError(e);
    }
  }),
  render: sshProtectedProcedure.input(renderPrincipalsSchema).query(async ({ ctx, input }) => {
    try {
      return await getSshPrincipalService().render(svcCtx(ctx), input.hostId);
    } catch (e) {
      mapSshError(e);
    }
  }),
  staleHosts: sshProtectedProcedure.query(async ({ ctx }) => getSshPrincipalService().staleHosts(svcCtx(ctx))),
  // Returns the service result verbatim so tRPC and REST
  // (POST /api/v1/ssh/hosts/:id/auth-principals/pushed) stay identical.
  markPushed: sshProtectedProcedure.input(renderPrincipalsSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshPrincipalService().markPushed(svcCtx(ctx), input.hostId);
    } catch (e) {
      mapSshError(e);
    }
  }),
});

const tokenRouter = router({
  list: sshAdminProcedure.query(async ({ ctx }) => getSshFleetTokenService().list(svcCtx(ctx))),
  mint: sshAdminProcedure
    .input(mintTokenSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await getSshFleetTokenService().mint(svcCtx(ctx), {
          name: input.name,
          userCaId: input.userCaId,
          hostCaId: input.hostCaId,
          opSet: input.opSet,
          zone: input.zone,
        });
      } catch (e) {
        mapSshError(e);
      }
    }),
  revoke: sshAdminProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await getSshFleetTokenService().revoke(svcCtx(ctx), input.id);
    return { ok: true };
  }),
});

const bulkRouter = router({
  expiring: sshProtectedProcedure.input(z.object({ withinSeconds: z.number().int().positive() })).query(async ({ ctx, input }) =>
    getSshBulkService().expiring(svcCtx(ctx), input.withinSeconds)
  ),
  renew: sshProtectedProcedure.input(z.object({ certIds: z.array(z.string().min(1)).min(1) })).mutation(async ({ ctx, input }) =>
    getSshBulkService().bulkRenew(svcCtx(ctx), input.certIds)
  ),
  revoke: sshProtectedProcedure
    .input(z.object({ certIds: z.array(z.string().min(1)).min(1), reason: z.string().max(256).optional() }))
    .mutation(async ({ ctx, input }) => getSshBulkService().bulkRevoke(svcCtx(ctx), input.certIds, input.reason)),
});

const krlRouter = router({
  getLatest: sshProtectedProcedure.input(sshCaIdSchema).query(async ({ ctx, input }) => {
    try {
      return await getSshKrlService().getLatest(svcCtx(ctx), input.id);
    } catch (e) {
      mapSshError(e);
    }
  }),
  listRevocations: sshProtectedProcedure.input(sshCaIdSchema).query(async ({ ctx, input }) =>
    getSshKrlService().listRevocations(svcCtx(ctx), input.id)
  ),
  generate: sshProtectedProcedure.input(sshCaIdSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshKrlService().generate(svcCtx(ctx), input.id);
    } catch (e) {
      mapSshError(e);
    }
  }),
  revokeCert: sshProtectedProcedure.input(revokeSshCertSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshKrlService().revokeByCert(svcCtx(ctx), input.certId, input.reason);
    } catch (e) {
      mapSshError(e);
    }
  }),
  revokeSerial: sshProtectedProcedure
    .input(z.object({ caId: z.string().min(1), serial: z.string().regex(/^\d+$/), reason: z.string().max(256).optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await getSshKrlService().revokeBySerial(svcCtx(ctx), input.caId, input.serial, input.reason);
      } catch (e) {
        mapSshError(e);
      }
    }),
  revokeKey: sshProtectedProcedure
    .input(z.object({ caId: z.string().min(1), fingerprint: z.string().min(1), reason: z.string().max(256).optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await getSshKrlService().revokeByKeyFingerprint(svcCtx(ctx), input.caId, input.fingerprint, input.reason);
      } catch (e) {
        mapSshError(e);
      }
    }),
});

// Per-host user access blocks (BLK-08, decision-016). Deliberately
// sshProtectedProcedure — the same tier as host revoke/offboard; CA-level
// actions stay admin-only. The actor (createdBy/liftedBy) is the OIDC subject
// when present.
const actorOf = (ctx: any): string | undefined =>
  ctx.user?.preferredUsername ?? ctx.user?.preferred_username ?? ctx.user?.email ?? ctx.user?.sub ?? undefined;

const blockRouter = router({
  block: sshProtectedProcedure.input(blockHostSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshBlockService().block(svcCtx(ctx), {
        hostId: input.hostId,
        identityId: input.identityId,
        reason: input.reason,
        createdBy: actorOf(ctx),
      });
    } catch (e) {
      mapSshError(e);
    }
  }),
  unblock: sshProtectedProcedure.input(unblockHostSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshBlockService().unblock(svcCtx(ctx), {
        hostId: input.hostId,
        identityId: input.identityId,
        liftedBy: actorOf(ctx),
      });
    } catch (e) {
      mapSshError(e);
    }
  }),
  listForHost: sshProtectedProcedure.input(z.object({ hostId: z.string().min(1) })).query(async ({ ctx, input }) =>
    getSshBlockService().listForHost(svcCtx(ctx), input.hostId)
  ),
  listForIdentity: sshProtectedProcedure.input(identityIdSchema).query(async ({ ctx, input }) =>
    getSshBlockService().listForIdentityWithState(svcCtx(ctx), input.id)
  ),
  // Pre-block check so the UI confirm can warn about fingerprint over-blocking
  // BEFORE the block is placed (decision-016 pinned confirm copy).
  collisions: sshProtectedProcedure.input(identityIdSchema).query(async ({ ctx, input }) =>
    getSshBlockService().sharedKeyCollisions(svcCtx(ctx), input.id)
  ),
  fleetDistribution: sshProtectedProcedure.query(async ({ ctx }) => getSshBlockService().fleetDistribution(svcCtx(ctx))),
});

const monRouter = router({
  metrics: sshProtectedProcedure
    .input(
      z
        .object({
          ttlWindowSeconds: z.number().int().positive().optional(),
          pullIntervalSeconds: z.number().int().positive().optional(),
          zoneId: z.string().min(1).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => getSshMonService().metrics(svcCtx(ctx), input)),
});

export const sshRouter = router({
  zone: zoneRouter,
  ca: caRouter,
  host: hostRouter,
  user: userRouter,
  principal: principalRouter,
  token: tokenRouter,
  bulk: bulkRouter,
  krl: krlRouter,
  block: blockRouter,
  mon: monRouter,
});
