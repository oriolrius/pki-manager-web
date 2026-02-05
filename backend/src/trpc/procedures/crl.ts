import { router, protectedProcedure } from '../init.js';
import {
  generateCrlSchema,
  getCrlSchema,
  listCrlsSchema,
} from '../schemas.js';
import { TRPCError } from '@trpc/server';
import {
  getCRLService,
  CRLCANotFoundError,
  CRLNotFoundError,
  CRLInvalidCAStatusError,
  CRLOperationError,
} from '../../services/crl.service.js';

// Helper to map service errors to tRPC errors
function mapServiceError(error: unknown): never {
  if (error instanceof CRLCANotFoundError) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: error.message,
    });
  }
  if (error instanceof CRLNotFoundError) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: error.message,
    });
  }
  if (error instanceof CRLInvalidCAStatusError) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error.message,
    });
  }
  if (error instanceof CRLOperationError) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: error.message,
    });
  }
  // Re-throw unknown errors
  throw error;
}

export const crlRouter = router({
  generate: protectedProcedure
    .input(generateCrlSchema)
    .mutation(async ({ ctx, input }) => {
      const crlService = getCRLService();

      try {
        return await crlService.generate(
          { db: ctx.db, ipAddress: ctx.req.ip },
          {
            caId: input.caId,
            nextUpdateDays: input.nextUpdateDays,
          }
        );
      } catch (error) {
        mapServiceError(error);
      }
    }),

  getLatest: protectedProcedure
    .input(getCrlSchema)
    .query(async ({ ctx, input }) => {
      const crlService = getCRLService();

      try {
        return await crlService.getLatest(
          { db: ctx.db, ipAddress: ctx.req.ip },
          {
            caId: input.caId,
            crlNumber: input.crlNumber,
          }
        );
      } catch (error) {
        mapServiceError(error);
      }
    }),

  list: protectedProcedure
    .input(listCrlsSchema)
    .query(async ({ ctx, input }) => {
      const crlService = getCRLService();

      try {
        return await crlService.list(
          { db: ctx.db, ipAddress: ctx.req.ip },
          {
            caId: input.caId,
            limit: input.limit,
            offset: input.offset,
          }
        );
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
