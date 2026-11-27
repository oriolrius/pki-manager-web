/**
 * Background CRL reconciliation (TASK-288). It publishes the CRLs that nothing else asks for:
 * a revocation whose CRL signing failed (OpenBao sealed or down), a publication that a stopped
 * process left with its lease, and expired CRLs. It runs a few seconds after the server starts
 * listening, then every minute; one pass handles one CA at a time, with the retry backoff of
 * `CRLService` (crl.service.ts). Every process of a shared database can run it: the publication
 * lease orders them. The first pass of a process reads the full state of each CA once (also a
 * CRL verified by an older version); later passes read it only when the change generation moved.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { ServiceContext } from './types.js';
import { getCRLService } from './crl.service.js';

export interface CrlReconcilerOptions {
  ctx: ServiceContext;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'debug'>;
  initialDelayMs?: number;
  intervalMs?: number;
}

export interface CrlReconciler {
  stop(): void;
}

export function startCrlReconciler(options: CrlReconcilerOptions): CrlReconciler {
  const { ctx, log, initialDelayMs = 5_000, intervalMs = 60_000 } = options;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let first = true;

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(run, delay);
    timer.unref?.();
  };

  async function run() {
    try {
      const result = await getCRLService().reconcile(ctx, { full: first });
      first = false;
      if (result.published > 0 || result.pending > 0) {
        log.info(result, 'CRL reconciliation pass');
      } else {
        log.debug(result, 'CRL reconciliation pass');
      }
    } catch (error) {
      log.warn({ error: error instanceof Error ? error.message : String(error) }, 'CRL reconciliation pass failed');
    } finally {
      schedule(intervalMs);
    }
  }

  schedule(initialDelayMs);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
