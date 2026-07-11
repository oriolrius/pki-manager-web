/**
 * Public CRL distribution endpoint, extracted as a registerable Fastify plugin so it can be
 * unit/integration-tested against the REAL handler (boot a Fastify instance and `register` it)
 * rather than a divergent inline copy. Mounted by server.ts and by tests alike.
 *
 *   GET /crl/:caId.crl  -> PEM  (application/x-pem-file)
 *   GET /crl/:caId.der  -> DER  (application/pkix-crl)
 *
 * Serves the latest signed CRL, lazily regenerating it (best-effort) when it has passed
 * nextUpdate so distributed CRLs stay fresh.
 */

import type { FastifyInstance } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { certificateAuthorities, crls } from '../../db/schema.js';
import { getCRLService } from '../../services/crl.service.js';

export async function publicCrlRoutes(fastify: FastifyInstance): Promise<void> {
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

      // Get latest CRL for this CA
      let latestCrl = await db
        .select()
        .from(crls)
        .where(eq(crls.caId, caId))
        .orderBy(desc(crls.crlNumber))
        .limit(1);

      // On-demand refresh: if the newest CRL has passed its nextUpdate, regenerate a fresh
      // one (with an incremented crlNumber) before serving (best-effort; falls back to the
      // stale CRL if the KMS/signing is unavailable).
      if (latestCrl.length > 0 && new Date() > latestCrl[0].nextUpdate) {
        const refreshed = await getCRLService().regenerateForCa({ db, ipAddress: req.ip }, caId);
        if (refreshed) {
          latestCrl = await db
            .select()
            .from(crls)
            .where(eq(crls.caId, caId))
            .orderBy(desc(crls.crlNumber))
            .limit(1);
        }
      }

      if (!latestCrl || latestCrl.length === 0) {
        reply.code(404);
        return { error: `No CRL available for CA ${caId}` };
      }

      const crl = latestCrl[0];

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

      // Calculate Cache-Control max-age based on time until nextUpdate
      const now = new Date();
      const maxAge = Math.max(0, Math.floor((crl.nextUpdate.getTime() - now.getTime()) / 1000));
      reply.header('Cache-Control', `public, max-age=${maxAge}`);

      return content;
    } catch (error) {
      fastify.log.error({ error, caId }, 'Failed to serve CRL');
      reply.code(500);
      return { error: 'Internal server error while serving CRL' };
    }
  });
}
