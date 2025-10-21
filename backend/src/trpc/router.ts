import { router, publicProcedure } from './init.js';
import { caRouter } from './procedures/ca.js';
import { certificateRouter } from './procedures/certificate.js';
import { crlRouter } from './procedures/crl.js';
import { auditRouter } from './procedures/audit.js';

export const appRouter = router({
  health: publicProcedure.query(() => {
    return {
      status: 'ok',
      message: 'tRPC server is running',
      timestamp: new Date().toISOString(),
    };
  }),

  ca: caRouter,
  certificate: certificateRouter,
  crl: crlRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;
