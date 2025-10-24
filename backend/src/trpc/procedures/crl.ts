import { router, publicProcedure } from '../init.js';
import {
  generateCrlSchema,
  getCrlSchema,
  listCrlsSchema,
} from '../schemas.js';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { certificateAuthorities, certificates, crls } from '../../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { generateCRL } from '../../crypto/crl.js';
import { parseCertificate } from '../../crypto/x509.js';
import { createAuditLog } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import type { CRLEntry } from '../../crypto/types.js';

export const crlRouter = router({
  generate: publicProcedure
    .input(generateCrlSchema)
    .mutation(async ({ ctx, input }) => {
      const { caId, nextUpdateDays = 7 } = input;

      // Retrieve CA from database
      const ca = await ctx.db
        .select()
        .from(certificateAuthorities)
        .where(eq(certificateAuthorities.id, caId))
        .limit(1);

      if (!ca || ca.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `CA with ID ${caId} not found`,
        });
      }

      const caRecord = ca[0];

      // Validate CA is active
      const now = new Date();
      if (caRecord.status !== 'active' && caRecord.status !== 'revoked') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot generate CRL for CA with status: ${caRecord.status}`,
        });
      }

      // Fetch CA certificate from KMS
      const { getKMSService } = await import('../../kms/service.js');
      const kmsService = getKMSService();
      const caCertificatePem = await kmsService.getCertificate(
        caRecord.kmsCertificateId,
        caRecord.id
      );

      const crlId = randomUUID();

      try {
        // Get all revoked certificates for this CA
        const revokedCerts = await ctx.db
          .select()
          .from(certificates)
          .where(and(eq(certificates.caId, caId), eq(certificates.status, 'revoked'))!);

        logger.info(
          {
            caId,
            revokedCount: revokedCerts.length,
          },
          'Generating CRL'
        );

        // Get the latest CRL number for this CA
        const latestCrl = await ctx.db
          .select()
          .from(crls)
          .where(eq(crls.caId, caId))
          .orderBy(desc(crls.crlNumber))
          .limit(1);

        const nextCrlNumber = latestCrl.length > 0 ? latestCrl[0].crlNumber + 1 : 1;

        // Prepare CRL entries
        const crlEntries: CRLEntry[] = revokedCerts.map((cert) => ({
          serialNumber: cert.serialNumber,
          revocationDate: cert.revocationDate || new Date(),
          // Map revocation reason string to enum value
          reason: undefined, // Simplified for now
        }));

        // Set CRL validity period
        const thisUpdate = new Date();
        const nextUpdate = new Date(Date.now() + nextUpdateDays * 24 * 60 * 60 * 1000);

        // Parse CA certificate to extract subject DN
        const caCertInfo = parseCertificate(caCertificatePem, 'PEM');

        // NOTE: CRL signing with KMS-stored keys is not yet supported
        // The current implementation uses a placeholder approach
        // Full implementation requires either:
        // 1. KMS enhancement to support CRL signing operations
        // 2. Alternative signing mechanism
        //
        // For now, we'll create a CRL record with metadata but mark it as unsigned
        const crlPem = ''; // Placeholder - would contain actual CRL PEM

        /*
        // This is what the full implementation would look like:
        const generatedCRL = generateCRL({
          issuer: caCertInfo.subject,
          crlNumber: nextCrlNumber,
          thisUpdate,
          nextUpdate,
          revokedCertificates: crlEntries,
          signingKey: caPrivateKeyPem, // Not available from KMS
          signatureAlgorithm: 'SHA256-RSA',
        });
        */

        // Store CRL record in database
        await ctx.db.insert(crls).values({
          id: crlId,
          caId: caId,
          crlNumber: nextCrlNumber,
          thisUpdate: thisUpdate,
          nextUpdate: nextUpdate,
          crlPem: crlPem,
          revokedCount: revokedCerts.length,
          createdAt: new Date(),
        } as any);

        // Create audit log entry
        await createAuditLog({
          db: ctx.db,
          operation: 'crl.generate',
          entityType: 'crl',
          entityId: crlId,
          status: 'success',
          details: {
            caId: caId,
            crlNumber: nextCrlNumber,
            revokedCount: revokedCerts.length,
            thisUpdate: thisUpdate.toISOString(),
            nextUpdate: nextUpdate.toISOString(),
            note: 'CRL metadata created; signing with KMS-stored keys not yet implemented',
          },
          ipAddress: ctx.req.ip,
        });

        logger.info(
          {
            crlId,
            caId,
            crlNumber: nextCrlNumber,
            revokedCount: revokedCerts.length,
          },
          'CRL generated successfully'
        );

        return {
          id: crlId,
          crlNumber: nextCrlNumber,
          thisUpdate: thisUpdate.toISOString(),
          nextUpdate: nextUpdate.toISOString(),
          revokedCount: revokedCerts.length,
          note: 'CRL metadata created; full signing implementation requires KMS enhancement',
        };
      } catch (error) {
        logger.error({ error, caId, crlId }, 'Failed to generate CRL');

        // Log failure to audit log
        await createAuditLog({
          db: ctx.db,
          operation: 'crl.generate',
          entityType: 'crl',
          entityId: crlId,
          status: 'failure',
          details: {
            error: error instanceof Error ? error.message : String(error),
            caId: caId,
          },
          ipAddress: ctx.req.ip,
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to generate CRL: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  getLatest: publicProcedure
    .input(getCrlSchema)
    .query(async ({ ctx, input }) => {
      const { caId, crlNumber } = input;

      // Verify CA exists
      const ca = await ctx.db
        .select()
        .from(certificateAuthorities)
        .where(eq(certificateAuthorities.id, caId))
        .limit(1);

      if (!ca || ca.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `CA with ID ${caId} not found`,
        });
      }

      let crl;

      if (crlNumber !== undefined) {
        // Get specific CRL by number
        const result = await ctx.db
          .select()
          .from(crls)
          .where(and(eq(crls.caId, caId), eq(crls.crlNumber, crlNumber))!)
          .limit(1);

        if (!result || result.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `CRL number ${crlNumber} not found for CA ${caId}`,
          });
        }

        crl = result[0];
      } else {
        // Get latest CRL
        const result = await ctx.db
          .select()
          .from(crls)
          .where(eq(crls.caId, caId))
          .orderBy(desc(crls.crlNumber))
          .limit(1);

        if (!result || result.length === 0) {
          return null; // No CRL generated yet
        }

        crl = result[0];
      }

      // Compute validity status
      const now = new Date();
      let validityStatus: 'valid' | 'expired';
      if (now > crl.nextUpdate) {
        validityStatus = 'expired';
      } else {
        validityStatus = 'valid';
      }

      // Get revoked certificates for this CA (for the list)
      const revokedCerts = await ctx.db
        .select({
          serialNumber: certificates.serialNumber,
          revocationDate: certificates.revocationDate,
          revocationReason: certificates.revocationReason,
        })
        .from(certificates)
        .where(and(eq(certificates.caId, caId), eq(certificates.status, 'revoked'))!);

      return {
        id: crl.id,
        caId: crl.caId,
        crlNumber: crl.crlNumber,
        thisUpdate: crl.thisUpdate.toISOString(),
        nextUpdate: crl.nextUpdate.toISOString(),
        validityStatus,
        revokedCount: crl.revokedCount,
        crlPem: crl.crlPem || null,
        crlDer: crl.crlPem ? Buffer.from(crl.crlPem).toString('base64') : null,
        revokedCertificates: revokedCerts.map((cert) => ({
          serialNumber: cert.serialNumber,
          revocationDate: cert.revocationDate?.toISOString() || null,
          revocationReason: cert.revocationReason || null,
        })),
        createdAt: crl.createdAt.toISOString(),
      };
    }),

  list: publicProcedure
    .input(listCrlsSchema)
    .query(async ({ ctx, input }) => {
      const { caId, limit = 50, offset = 0 } = input;

      // Verify CA exists
      const ca = await ctx.db
        .select()
        .from(certificateAuthorities)
        .where(eq(certificateAuthorities.id, caId))
        .limit(1);

      if (!ca || ca.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `CA with ID ${caId} not found`,
        });
      }

      // Get CRLs for this CA with pagination (most recent first)
      const crlList = await ctx.db
        .select()
        .from(crls)
        .where(eq(crls.caId, caId))
        .orderBy(desc(crls.crlNumber))
        .limit(limit)
        .offset(offset);

      // Get total count
      const countResult = await ctx.db
        .select({ count: sql`count(*)` })
        .from(crls)
        .where(eq(crls.caId, caId));
      const totalCount = Number(countResult[0]?.count || 0);

      const now = new Date();

      const formattedCrls = crlList.map((crl) => {
        let validityStatus: 'valid' | 'expired';
        if (now > crl.nextUpdate) {
          validityStatus = 'expired';
        } else {
          validityStatus = 'valid';
        }

        return {
          id: crl.id,
          crlNumber: crl.crlNumber,
          thisUpdate: crl.thisUpdate.toISOString(),
          nextUpdate: crl.nextUpdate.toISOString(),
          validityStatus,
          revokedCount: crl.revokedCount,
          createdAt: crl.createdAt.toISOString(),
        };
      });

      return {
        items: formattedCrls,
        totalCount,
        limit,
        offset,
      };
    }),
});
