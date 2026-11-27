/**
 * Public CRL distribution endpoint, extracted as a registerable Fastify plugin so it can be
 * unit/integration-tested against the REAL handler (boot a Fastify instance and `register` it)
 * rather than a divergent inline copy. Mounted by server.ts and by tests alike.
 *
 *   GET /crl/:caId.crl  -> PEM  (application/x-pem-file)
 *   GET /crl/:caId.der  -> DER  (application/pkix-crl)
 *
 * Serves the newest signed CRL. Before it serves, it makes the CRL current (best-effort,
 * `CRLService.refreshForDistribution`): it publishes a new CRL when the CA has none, when the
 * newest one has an empty PEM (issue #48) or has passed nextUpdate, or when it does not list the
 * revocations of the database (for example after a revocation while OpenBao was sealed). When
 * the signing fails, it serves the CRL it has, with a short cache time.
 *
 * In a listening server, the plugin also runs the background CRL reconciliation
 * (`services/crl-reconciler.ts`), which publishes pending CRLs when nobody downloads them, also
 * after a restart. `inject()` and `ready()` do not start it.
 */

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { certificateAuthorities } from '../../db/schema.js';
import { CRL_PENDING_MAX_AGE_SECONDS, getCRLService } from '../../services/crl.service.js';
import { startCrlReconciler, type CrlReconciler } from '../../services/crl-reconciler.js';

export interface PublicCrlRoutesOptions {
  /** Timing of the background CRL reconciliation (tests); false: do not run it. */
  reconciler?: false | { initialDelayMs?: number; intervalMs?: number };
}

export async function publicCrlRoutes(fastify: FastifyInstance, options: PublicCrlRoutesOptions = {}): Promise<void> {
  let reconciler: CrlReconciler | null = null;
  fastify.addHook('onListen', async () => {
    if (options.reconciler === false) return;
    reconciler = startCrlReconciler({ ctx: { db, ipAddress: null }, log: fastify.log, ...options.reconciler });
  });
  fastify.addHook('onClose', async () => {
    reconciler?.stop();
  });

  fastify.get('/crl/:caId.:format', { schema: { hide: true } }, async (req, reply) => {
    const { caId, format } = req.params as { caId: string; format: string };

    // Validate format
    if (format !== 'crl' && format !== 'der') {
      reply.code(400);
      return { error: 'Invalid format. Use .crl for PEM or .der for DER format' };
    }

    try {
      // Check if CA exists
      const ca = await db
        .select()
        .from(certificateAuthorities)
        .where(eq(certificateAuthorities.id, caId))
        .limit(1);

      if (!ca || ca.length === 0) {
        reply.code(404);
        return { error: `CA with ID ${caId} not found` };
      }

      // Make the CRL current before it is served (best-effort, see the header). A CA that has
      // no CRL yet gets its first, empty CRL now.
      const publication = await getCRLService().refreshForDistribution({ db, ipAddress: req.ip }, caId);
      const crl = publication.crl;

      if (!crl) {
        reply.code(404);
        return { error: `No CRL available for CA ${caId}` };
      }

      // A signed CRL must have PEM content; an empty one indicates a generation problem.
      if (!crl.crlPem) {
        reply.code(503);
        return { error: 'CRL not available (empty)' };
      }

      // Convert to appropriate format
      let content: Buffer;
      let contentType: string;

      if (format === 'crl') {
        // PEM format (textual CRL armor)
        content = Buffer.from(crl.crlPem, 'utf8');
        contentType = 'application/x-pem-file';
      } else {
        // DER format - strip PEM armor and decode base64
        const base64Data = crl.crlPem
          .replace(/-----BEGIN X509 CRL-----/, '')
          .replace(/-----END X509 CRL-----/, '')
          .replace(/\n/g, '')
          .trim();
        content = Buffer.from(base64Data, 'base64');
        contentType = 'application/pkix-crl';
      }

      // Set headers according to RFC 5280
      reply.header('Content-Type', contentType);
      reply.header('Last-Modified', crl.thisUpdate.toUTCString());
      reply.header('Expires', crl.nextUpdate.toUTCString());

      // Cache-Control max-age: the time until nextUpdate. A pending CRL (it does not list the
      // database state yet) gets a short one, so that caches fetch the next CRL soon.
      const now = new Date();
      let maxAge = Math.max(0, Math.floor((crl.nextUpdate.getTime() - now.getTime()) / 1000));
      if (publication.status === 'pending') maxAge = Math.min(maxAge, CRL_PENDING_MAX_AGE_SECONDS);
      reply.header('Cache-Control', `public, max-age=${maxAge}`);

      return content;
    } catch (error) {
      fastify.log.error({ error, caId }, 'Failed to serve CRL');
      reply.code(500);
      return { error: 'Internal server error while serving CRL' };
    }
  });
}
