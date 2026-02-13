import { router, protectedProcedure, adminProcedure } from '../init.js';
import {
  listCasSchema,
  getCaSchema,
  createCaSchema,
  revokeCaSchema,
  deleteCaSchema,
} from '../schemas.js';
import { TRPCError } from '@trpc/server';
import {
  getCAService,
  CANotFoundError,
  CAAlreadyRevokedError,
  CANotRevokableError,
  CAHasActiveCertificatesError,
  CAOperationError,
  CAKmsInconsistencyError,
} from '../../services/ca.service.js';

// Helper to map service errors to tRPC errors
function mapServiceError(error: unknown): never {
  if (error instanceof CANotFoundError) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: error.message,
    });
  }
  if (error instanceof CAKmsInconsistencyError) {
    // Data inconsistency between DB and KMS - use CONFLICT (HTTP 409)
    // This is a known/manageable situation, not a server error
    // Include metadata to help frontend display useful information
    throw new TRPCError({
      code: 'CONFLICT',
      message: error.message,
      cause: {
        type: 'KMS_INCONSISTENCY',
        caId: error.caId,
        kmsCertificateId: error.metadata?.kmsCertificateId,
        subjectDn: error.metadata?.subjectDn,
        serialNumber: error.metadata?.serialNumber,
      },
    });
  }
  if (error instanceof CAAlreadyRevokedError) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error.message,
    });
  }
  if (error instanceof CANotRevokableError) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error.message,
    });
  }
  if (error instanceof CAHasActiveCertificatesError) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error.message,
    });
  }
  if (error instanceof CAOperationError) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: error.message,
    });
  }
  // Re-throw unknown errors
  throw error;
}

export const caRouter = router({
  list: protectedProcedure.input(listCasSchema).query(async ({ ctx, input }) => {
    const caService = getCAService();
    const params = input || {
      sortBy: 'issuedDate' as const,
      sortOrder: 'desc' as const,
      limit: 50,
      offset: 0,
    };

    return caService.list(
      { db: ctx.db, ipAddress: ctx.req.ip },
      {
        status: params.status,
        search: params.search,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
        limit: params.limit,
        offset: params.offset,
      }
    );
  }),

  getById: protectedProcedure.input(getCaSchema).query(async ({ ctx, input }) => {
    const caService = getCAService();

    try {
      return await caService.getById(
        { db: ctx.db, ipAddress: ctx.req.ip },
        input.id
      );
    } catch (error) {
      mapServiceError(error);
    }
  }),

  create: adminProcedure
    .input(createCaSchema)
    .mutation(async ({ ctx, input }) => {
      // Explicit role check as safety net (adminProcedure middleware should also check this)
      const authenticatedCtx = ctx as { user?: { roles?: string[] } };
      if (!authenticatedCtx.user?.roles?.includes('admin')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admin role required to create CA',
        });
      }

      const caService = getCAService();

      try {
        return await caService.create(
          { db: ctx.db, ipAddress: ctx.req.ip },
          {
            subject: {
              commonName: input.subject.commonName,
              organization: input.subject.organization,
              organizationalUnit: input.subject.organizationalUnit,
              country: input.subject.country,
              state: input.subject.state,
              locality: input.subject.locality,
            },
            keyAlgorithm: input.keyAlgorithm,
            validityYears: input.validityYears,
            tags: input.tags,
          }
        );
      } catch (error) {
        mapServiceError(error);
      }
    }),

  revoke: adminProcedure
    .input(revokeCaSchema)
    .mutation(async ({ ctx, input }) => {
      const caService = getCAService();

      try {
        return await caService.revoke(
          { db: ctx.db, ipAddress: ctx.req.ip },
          {
            id: input.id,
            reason: input.reason,
            details: input.details,
          }
        );
      } catch (error) {
        mapServiceError(error);
      }
    }),

  delete: adminProcedure
    .input(deleteCaSchema)
    .mutation(async ({ ctx, input }) => {
      const caService = getCAService();

      try {
        return await caService.delete(
          { db: ctx.db, ipAddress: ctx.req.ip },
          {
            id: input.id,
            destroyKey: input.destroyKey,
            forceDelete: input.forceDelete,
          }
        );
      } catch (error) {
        mapServiceError(error);
      }
    }),
});
