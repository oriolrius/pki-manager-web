import { router, publicProcedure } from '../init.js';
import {
  generateCrlSchema,
  getCrlSchema,
  listCrlsSchema,
} from '../schemas.js';

export const crlRouter = router({
  generate: publicProcedure
    .input(generateCrlSchema)
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement in task-022 (CRL generation backend endpoint)
      throw new Error('Not implemented yet');
    }),

  getLatest: publicProcedure
    .input(getCrlSchema)
    .query(async ({ ctx, input }) => {
      // TODO: Implement in task-023 (CRL retrieval backend endpoints)
      return null;
    }),

  list: publicProcedure
    .input(listCrlsSchema)
    .query(async ({ ctx, input }) => {
      // TODO: Implement in task-023 (CRL retrieval backend endpoints)
      return [];
    }),
});
