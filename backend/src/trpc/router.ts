import { router, publicProcedure } from './init.js';
import { caRouter } from './procedures/ca.js';
import { certificateRouter } from './procedures/certificate.js';
import { crlRouter } from './procedures/crl.js';
import { auditRouter } from './procedures/audit.js';
import { domainRouter } from './procedures/domain.js';
import { searchRouter } from './procedures/search.js';
import { dashboardRouter } from './procedures/dashboard.js';

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
  domain: domainRouter,
  search: searchRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
