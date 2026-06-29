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
  if (error instanceof SshHostError || error instanceof SshUserError || error instanceof SshPrincipalError) {
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
      return await getSshCaService().create(svcCtx(ctx), input);
    } catch (e) {
      mapSshError(e);
    }
  }),
  import: sshAdminProcedure.input(importSshCaSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshCaService().import(svcCtx(ctx), input);
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
      return await getSshHostService().register(svcCtx(ctx), input);
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
});

const userRouter = router({
  listIdentities: sshProtectedProcedure.query(async ({ ctx }) => getSshUserService().listIdentities(svcCtx(ctx))),
  createIdentity: sshProtectedProcedure.input(createIdentitySchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshUserService().createIdentity(svcCtx(ctx), input);
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
  issue: sshProtectedProcedure.input(issueUserCertSchema).mutation(async ({ ctx, input }) => {
    try {
      return await getSshUserService().issue(svcCtx(ctx), input);
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
      return await getSshPrincipalService().createPrincipal(svcCtx(ctx), input);
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
    await getSshPrincipalService().grantToIdentity(svcCtx(ctx), input);
    return { ok: true };
  }),
  map: sshProtectedProcedure.input(mapPrincipalSchema).mutation(async ({ ctx, input }) => {
    try {
      await getSshPrincipalService().mapToHost(svcCtx(ctx), input);
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

export const sshRouter = router({
  ca: caRouter,
  host: hostRouter,
  user: userRouter,
  principal: principalRouter,
});
