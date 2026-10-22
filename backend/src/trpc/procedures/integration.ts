import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../init.js';
import {
  registerIntegrationSchema,
  revokeIntegrationSchema,
  getIntegrationSchema,
} from '../schemas.js';
import {
  getIntegrationService,
  IntegrationNotFoundError,
  IntegrationCANotFoundError,
  IntegrationRevokedError,
} from '../../services/integration.service.js';

function mapError(error: unknown): never {
  if (error instanceof IntegrationNotFoundError) {
    throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
  }
  if (error instanceof IntegrationCANotFoundError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  if (error instanceof IntegrationRevokedError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  throw error;
}

export const integrationRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const svc = getIntegrationService();
    return svc.list({ db: ctx.db, ipAddress: ctx.req.ip });
  }),

  getById: protectedProcedure.input(getIntegrationSchema).query(async ({ ctx, input }) => {
    const svc = getIntegrationService();
    try {
      return await svc.getById({ db: ctx.db, ipAddress: ctx.req.ip }, input.id);
    } catch (e) {
      mapError(e);
    }
  }),

  register: adminProcedure
    .input(registerIntegrationSchema)
    .mutation(async ({ ctx, input }) => {
      const svc = getIntegrationService();
      const userSub = (ctx as { user?: { sub?: string } }).user?.sub;
      try {
        return await svc.register(
          { db: ctx.db, ipAddress: ctx.req.ip },
          {
            name: input.name,
            description: input.description,
            caId: input.caId,
            kind: input.kind,
            createdBy: userSub,
          }
        );
      } catch (e) {
        mapError(e);
      }
    }),

  revoke: adminProcedure.input(revokeIntegrationSchema).mutation(async ({ ctx, input }) => {
    const svc = getIntegrationService();
    try {
      return await svc.revoke({ db: ctx.db, ipAddress: ctx.req.ip }, input.id);
    } catch (e) {
      mapError(e);
    }
  }),
});
