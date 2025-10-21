import { router, publicProcedure } from '../init.js';
import {
  listCasSchema,
  getCaSchema,
  createCaSchema,
  revokeCaSchema,
  deleteCaSchema,
} from '../schemas.js';

export const caRouter = router({
  list: publicProcedure.input(listCasSchema).query(async ({ ctx, input }) => {
    // TODO: Implement in task-007 (CA creation) and task-008 (CA listing)
    return [];
  }),

  getById: publicProcedure.input(getCaSchema).query(async ({ ctx, input }) => {
    // TODO: Implement in task-009 (CA detail retrieval)
    return null;
  }),

  create: publicProcedure
    .input(createCaSchema)
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement in task-007 (CA creation backend endpoint)
      throw new Error('Not implemented yet');
    }),

  revoke: publicProcedure
    .input(revokeCaSchema)
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement in task-010 (CA revocation)
      throw new Error('Not implemented yet');
    }),

  delete: publicProcedure
    .input(deleteCaSchema)
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement in task-011 (CA deletion)
      throw new Error('Not implemented yet');
    }),
});
