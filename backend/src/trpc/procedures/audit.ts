import { router, publicProcedure } from '../init.js';
import { listAuditLogSchema } from '../schemas.js';

export const auditRouter = router({
  list: publicProcedure
    .input(listAuditLogSchema)
    .query(async ({ ctx, input }) => {
      // TODO: Implement in task-026 (Comprehensive audit logging)
      return [];
    }),

  export: publicProcedure
    .input(listAuditLogSchema)
    .query(async ({ ctx, input }) => {
      // TODO: Implement in task-027 (Compliance reporting backend)
      throw new Error('Not implemented yet');
    }),
});
