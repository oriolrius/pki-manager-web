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
} from '../ssh-schemas.js';
import { getSshCaService, SshCaExistsError, SshCaAlgorithmError, SshCaNotFoundError } from '../../services/ssh-ca.service.js';
import { getSshHostService, SshHostError } from '../../services/ssh-host.service.js';
import { getSshUserService, SshUserError } from '../../services/ssh-user.service.js';
import { getSshPrincipalService, SshPrincipalError } from '../../services/ssh-principal.service.js';
import { getSshFleetTokenService, SshTokenError } from '../../services/ssh-fleet-token.service.js';
import { getSshBulkService } from '../../services/ssh-bulk.service.js';
import { getSshKrlService, SshKrlError } from '../../services/ssh-krl.service.js';
import { getSshMonService } from '../../services/ssh-mon.service.js';
import {
  SshSignCaNotFoundError,
  SshCaUnusableError,
  SshCertTypeMismatchError,
} from '../../services/ssh-cert.service.js';

function mapSshError(error: unknown): never {
  if (error instanceof SshCaExistsError) throw new TRPCError({ code: 'CONFLICT', message: error.message });
  if (error instanceof SshCaNotFoundError || error instanceof SshSignCaNotFoundError)
    throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
  if (error instanceof SshCaAlgorithmError || error instanceof SshCaUnusableError || error instanceof SshCertTypeMismatchError)
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  if (error instanceof SshHostError || error instanceof SshUserError || error instanceof SshPrincipalError || error instanceof SshTokenError || error instanceof SshKrlError) {
    const code = /not found/i.test(error.message) ? 'NOT_FOUND' : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.message });
  }
  throw error;
}

const svcCtx = (ctx: any) => ({ db: ctx.db, ipAddress: ctx.req?.ip ?? null });

const caRouter = router({
  list: sshProtectedProcedure.query(async ({ ctx }) => getSshCaService().list(svcCtx(ctx))),
  get: sshProtectedProcedure.input(sshCaIdSchema).query(async ({ ctx, input }) => {
    try {
      return await getSshCaService().get(svcCtx(ctx), input.id);
    } catch (e) {
      mapSshError(e);
    }
  }),
  trustAnchors: sshProtectedProcedure.query(async ({ ctx }) => getSshCaService().getTrustAnchors(svcCtx(ctx))),
  create: sshAdminProcedure.input(createSshCaSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshCaService().create(svcCtx(ctx), { caType: input.caType, label: input.label });
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
  list: sshProtectedProcedure.query(async ({ ctx }) => getSshHostService().list(svcCtx(ctx))),
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
  listIdentities: sshProtectedProcedure.query(async ({ ctx }) => getSshUserService().listIdentities(svcCtx(ctx))),
  createIdentity: sshProtectedProcedure.input(createIdentitySchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshUserService().createIdentity(svcCtx(ctx), {
        subject: input.subject,
        email: input.email,
        externalSubject: input.externalSubject,
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
  list: sshProtectedProcedure.query(async ({ ctx }) => getSshPrincipalService().listPrincipals(svcCtx(ctx))),
  create: sshProtectedProcedure.input(createPrincipalSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshPrincipalService().createPrincipal(svcCtx(ctx), { name: input.name, description: input.description });
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
  markPushed: sshProtectedProcedure.input(renderPrincipalsSchema).mutation(async ({ ctx, input }) => {
    await getSshPrincipalService().markPushed(svcCtx(ctx), input.hostId);
    return { ok: true };
  }),
});

const tokenRouter = router({
  list: sshAdminProcedure.query(async ({ ctx }) => getSshFleetTokenService().list(svcCtx(ctx))),
  mint: sshAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        userCaId: z.string().optional(),
        hostCaId: z.string().optional(),
        opSet: z.array(z.enum(['sign-host', 'sign-user', 'register-host-pubkey'])).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await getSshFleetTokenService().mint(svcCtx(ctx), {
          name: input.name,
          userCaId: input.userCaId,
          hostCaId: input.hostCaId,
          opSet: input.opSet,
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

const monRouter = router({
  metrics: sshProtectedProcedure
    .input(z.object({ ttlWindowSeconds: z.number().int().positive().optional(), pullIntervalSeconds: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => getSshMonService().metrics(svcCtx(ctx), input)),
});

export const sshRouter = router({
  ca: caRouter,
  host: hostRouter,
  user: userRouter,
  principal: principalRouter,
  token: tokenRouter,
  bulk: bulkRouter,
  krl: krlRouter,
  mon: monRouter,
});
