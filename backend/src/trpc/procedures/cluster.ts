import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from '../init.js';
import {
  registerClusterSchema,
  revokeClusterSchema,
  getClusterSchema,
} from '../schemas.js';
import {
  getClusterService,
  ClusterNotFoundError,
  ClusterCANotFoundError,
  ClusterRevokedError,
} from '../../services/cluster.service.js';

function mapError(error: unknown): never {
  if (error instanceof ClusterNotFoundError) {
    throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
  }
  if (error instanceof ClusterCANotFoundError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  if (error instanceof ClusterRevokedError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
  }
  throw error;
}

export const clusterRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const svc = getClusterService();
    return svc.list({ db: ctx.db, ipAddress: ctx.req.ip });
  }),

  getById: protectedProcedure.input(getClusterSchema).query(async ({ ctx, input }) => {
    const svc = getClusterService();
    try {
      return await svc.getById({ db: ctx.db, ipAddress: ctx.req.ip }, input.id);
    } catch (e) {
      mapError(e);
    }
  }),

  register: adminProcedure
    .input(registerClusterSchema)
    .mutation(async ({ ctx, input }) => {
      const svc = getClusterService();
      const userSub = (ctx as { user?: { sub?: string } }).user?.sub;
      try {
        return await svc.register(
          { db: ctx.db, ipAddress: ctx.req.ip },
          {
            name: input.name,
            description: input.description,
            caId: input.caId,
            createdBy: userSub,
          }
        );
      } catch (e) {
        mapError(e);
      }
    }),

  revoke: adminProcedure.input(revokeClusterSchema).mutation(async ({ ctx, input }) => {
    const svc = getClusterService();
    try {
      return await svc.revoke({ db: ctx.db, ipAddress: ctx.req.ip }, input.id);
    } catch (e) {
      mapError(e);
    }
  }),
});
