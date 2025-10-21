import { router, publicProcedure } from '../init.js';
import {
  listCertificatesSchema,
  getCertificateSchema,
  createCertificateSchema,
  renewCertificateSchema,
  revokeCertificateSchema,
  deleteCertificateSchema,
} from '../schemas.js';

export const certificateRouter = router({
  list: publicProcedure
    .input(listCertificatesSchema)
    .query(async ({ ctx, input }) => {
      // TODO: Implement in task-013 (Certificate listing)
      return [];
    }),

  getById: publicProcedure
    .input(getCertificateSchema)
    .query(async ({ ctx, input }) => {
      // TODO: Implement in task-014 (Certificate detail retrieval)
      return null;
    }),

  issue: publicProcedure
    .input(createCertificateSchema)
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement in task-012 (Certificate issuance for server certificates)
      throw new Error('Not implemented yet');
    }),

  renew: publicProcedure
    .input(renewCertificateSchema)
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement in task-015 (Certificate renewal)
      throw new Error('Not implemented yet');
    }),

  revoke: publicProcedure
    .input(revokeCertificateSchema)
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement in task-016 (Certificate revocation)
      throw new Error('Not implemented yet');
    }),

  delete: publicProcedure
    .input(deleteCertificateSchema)
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement in task-017 (Certificate deletion)
      throw new Error('Not implemented yet');
    }),

  download: publicProcedure
    .input(getCertificateSchema)
    .query(async ({ ctx, input }) => {
      // TODO: Implement in task-018 (Certificate download)
      throw new Error('Not implemented yet');
    }),
});
