import { router, publicProcedure } from '../init.js';
import {
  listCasSchema,
  getCaSchema,
  createCaSchema,
  revokeCaSchema,
  deleteCaSchema,
} from '../schemas.js';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { certificateAuthorities, certificates, crls, auditLog } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { formatDN } from '../../crypto/dn.js';
import { parseCertificate } from '../../crypto/x509.js';
import { logger } from '../../lib/logger.js';
import { eq, and, sql, like, desc, asc } from 'drizzle-orm';
import type { DistinguishedName } from '../../crypto/types.js';

export const caRouter = router({
  list: publicProcedure.input(listCasSchema).query(async ({ ctx, input }) => {
    const params = input || {
      sortBy: 'issuedDate' as const,
      sortOrder: 'desc' as const,
      limit: 50,
      offset: 0,
    };
    const now = new Date();

    // Build WHERE conditions
    const conditions: any[] = [];

    // Filter by status
    if (params.status) {
      if (params.status === 'expired') {
        // For expired, check notAfter < now
        conditions.push(sql`${certificateAuthorities.notAfter} < ${now.getTime() / 1000}`);
      } else if (params.status === 'active') {
        // For active, status must be 'active' AND not expired
        conditions.push(
          and(
            eq(certificateAuthorities.status, 'active'),
            sql`${certificateAuthorities.notAfter} >= ${now.getTime() / 1000}`,
          )!,
        );
      } else {
        // For revoked, just check status
        conditions.push(eq(certificateAuthorities.status, params.status));
      }
    }

    // Filter by algorithm
    if (params.algorithm) {
      conditions.push(eq(certificateAuthorities.keyAlgorithm, params.algorithm));
    }

    // Search in CN, O, OU (within subjectDn)
    if (params.search) {
      const searchPattern = `%${params.search}%`;
      conditions.push(like(certificateAuthorities.subjectDn, searchPattern));
    }

    // Build the WHERE clause
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Determine sort column
    let orderByColumn;
    switch (params.sortBy) {
      case 'name':
        orderByColumn = certificateAuthorities.subjectDn;
        break;
      case 'expiryDate':
        orderByColumn = certificateAuthorities.notAfter;
        break;
      case 'issuedDate':
      default:
        orderByColumn = certificateAuthorities.notBefore;
        break;
    }

    // Determine sort direction
    const orderBy = params.sortOrder === 'asc' ? asc(orderByColumn) : desc(orderByColumn);

    // Query CAs with pagination
    const cas = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(params.limit)
      .offset(params.offset);

    // Get certificate counts for each CA
    const casWithCounts = await Promise.all(
      cas.map(async (ca) => {
        // Count certificates issued by this CA
        const certCount = await ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(certificates)
          .where(eq(certificates.caId, ca.id));

        // Compute actual status based on current date
        let computedStatus: 'active' | 'revoked' | 'expired' = ca.status as any;
        if (ca.status === 'active' && ca.notAfter < now) {
          computedStatus = 'expired';
        }

        return {
          id: ca.id,
          subject: ca.subjectDn,
          serialNumber: ca.serialNumber,
          keyAlgorithm: ca.keyAlgorithm,
          notBefore: ca.notBefore.toISOString(),
          notAfter: ca.notAfter.toISOString(),
          status: computedStatus,
          certificateCount: Number(certCount[0]?.count || 0),
          createdAt: ca.createdAt.toISOString(),
        };
      }),
    );

    return casWithCounts;
  }),

  getById: publicProcedure.input(getCaSchema).query(async ({ ctx, input }) => {
    // Retrieve CA from database
    const ca = await ctx.db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, input.id))
      .limit(1);

    if (!ca || ca.length === 0) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `CA with ID ${input.id} not found`,
      });
    }

    const caRecord = ca[0];
    const now = new Date();

    // Parse certificate to extract detailed information
    const certMetadata = parseCertificate(caRecord.certificatePem, 'PEM');

    // Calculate fingerprints using node-forge
    const forge = (await import('node-forge')).default;
    const cert = forge.pki.certificateFromPem(caRecord.certificatePem);

    // Create message digests
    const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const sha256Digest = forge.md.sha256.create();
    sha256Digest.update(derBytes);
    const sha256Fingerprint = sha256Digest.digest().toHex().toUpperCase();

    const sha1Digest = forge.md.sha1.create();
    sha1Digest.update(derBytes);
    const sha1Fingerprint = sha1Digest.digest().toHex().toUpperCase();

    // Format fingerprints with colons
    const formatFingerprint = (hex: string) =>
      hex.match(/.{1,2}/g)?.join(':') || hex;

    // Extract extensions
    const extensions: any = {};

    for (const ext of certMetadata.extensions) {
      if (ext.name === 'basicConstraints') {
        extensions.basicConstraints = {
          cA: (ext as any).cA || false,
          pathLenConstraint: (ext as any).pathLenConstraint,
        };
      } else if (ext.name === 'keyUsage') {
        extensions.keyUsage = {
          digitalSignature: (ext as any).digitalSignature || false,
          nonRepudiation: (ext as any).nonRepudiation || false,
          keyEncipherment: (ext as any).keyEncipherment || false,
          dataEncipherment: (ext as any).dataEncipherment || false,
          keyAgreement: (ext as any).keyAgreement || false,
          keyCertSign: (ext as any).keyCertSign || false,
          cRLSign: (ext as any).cRLSign || false,
          encipherOnly: (ext as any).encipherOnly || false,
          decipherOnly: (ext as any).decipherOnly || false,
        };
      } else if (ext.name === 'subjectKeyIdentifier') {
        // Extract the key identifier value
        const skiExt = cert.extensions.find((e: any) => e.name === 'subjectKeyIdentifier');
        if (skiExt && (skiExt as any).subjectKeyIdentifier) {
          extensions.subjectKeyIdentifier = (skiExt as any).subjectKeyIdentifier;
        }
      } else if (ext.name === 'authorityKeyIdentifier') {
        const akiExt = cert.extensions.find((e: any) => e.name === 'authorityKeyIdentifier');
        if (akiExt && (akiExt as any).keyIdentifier) {
          extensions.authorityKeyIdentifier = (akiExt as any).keyIdentifier;
        }
      }
    }

    // Compute validity status
    let validityStatus: 'valid' | 'expired' | 'not_yet_valid' = 'valid';
    if (now < caRecord.notBefore) {
      validityStatus = 'not_yet_valid';
    } else if (now > caRecord.notAfter) {
      validityStatus = 'expired';
    }

    // Compute overall status
    let status: 'active' | 'revoked' | 'expired' = caRecord.status as any;
    if (caRecord.status === 'active' && now > caRecord.notAfter) {
      status = 'expired';
    }

    // Count issued certificates
    const certCount = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(certificates)
      .where(eq(certificates.caId, input.id));

    return {
      id: caRecord.id,
      subject: certMetadata.subject,
      subjectDn: caRecord.subjectDn,
      issuer: certMetadata.issuer,
      issuerDn: caRecord.subjectDn, // Self-signed, so issuer = subject
      serialNumber: caRecord.serialNumber,
      keyAlgorithm: caRecord.keyAlgorithm,
      notBefore: caRecord.notBefore.toISOString(),
      notAfter: caRecord.notAfter.toISOString(),
      validityStatus,
      status,
      extensions,
      fingerprints: {
        sha256: formatFingerprint(sha256Fingerprint),
        sha1: formatFingerprint(sha1Fingerprint),
      },
      certificatePem: caRecord.certificatePem,
      issuedCertificateCount: Number(certCount[0]?.count || 0),
      revocationDate: caRecord.revocationDate?.toISOString(),
      revocationReason: caRecord.revocationReason,
      createdAt: caRecord.createdAt.toISOString(),
      updatedAt: caRecord.updatedAt.toISOString(),
    };
  }),

  create: publicProcedure
    .input(createCaSchema)
    .mutation(async ({ ctx, input }) => {
      const caId = randomUUID();
      const kmsService = getKMSService();

      try {
        // Convert API schema DN to crypto DN format
        const subjectDN: DistinguishedName = {
          CN: input.subject.commonName,
          O: input.subject.organization,
          OU: input.subject.organizationalUnit,
          C: input.subject.country,
          ST: input.subject.state,
          L: input.subject.locality,
        };

        // Determine key size from algorithm
        let keySizeInBits = 4096;
        if (input.keyAlgorithm === 'RSA-2048') {
          keySizeInBits = 2048;
        }

        // Generate key pair in KMS
        logger.info({ caId, keyAlgorithm: input.keyAlgorithm }, 'Creating CA key pair in KMS');
        const keyPair = await kmsService.createKeyPair({
          sizeInBits: keySizeInBits,
          tags: input.tags || [],
          purpose: 'ca',
          entityId: caId,
        });

        // Create self-signed root certificate using KMS certify
        const validityDays = (input.validityYears || 20) * 365;
        const subjectName = formatDN(subjectDN);

        logger.info(
          { caId, subjectName, validityDays },
          'Creating self-signed root certificate in KMS',
        );

        const certInfo = await kmsService.signCertificate({
          publicKeyId: keyPair.publicKeyId,
          issuerPrivateKeyId: keyPair.privateKeyId, // Self-signed: use own private key
          subjectName: subjectName,
          daysValid: validityDays,
          tags: input.tags || [],
          entityId: caId,
        });

        // Convert certificate data from hex to PEM
        const certDataHex = certInfo.certificateData;
        const certDataBuffer = Buffer.from(certDataHex, 'hex');
        const certBase64 = certDataBuffer.toString('base64');
        const certificatePem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;

        // Parse certificate to extract metadata
        const certMetadata = parseCertificate(certificatePem, 'PEM');

        // Calculate timestamps
        const notBefore = certMetadata.validity.notBefore;
        const notAfter = certMetadata.validity.notAfter;

        // Store CA record in database
        await ctx.db.insert(certificateAuthorities).values({
          id: caId,
          subjectDn: subjectName,
          serialNumber: certMetadata.serialNumber,
          keyAlgorithm: input.keyAlgorithm || 'RSA-4096',
          notBefore: notBefore,
          notAfter: notAfter,
          kmsKeyId: keyPair.privateKeyId,
          kmsCertificateId: certInfo.certificateId,
          certificatePem: certificatePem,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Create audit log entry
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'ca.create',
          entityType: 'ca',
          entityId: caId,
          status: 'success',
          details: JSON.stringify({
            subject: subjectName,
            keyAlgorithm: input.keyAlgorithm,
            validityYears: input.validityYears,
            serialNumber: certMetadata.serialNumber,
            kmsKeyId: keyPair.privateKeyId,
          }),
          ipAddress: ctx.req.ip,
        });

        logger.info({ caId, subjectName }, 'CA created successfully');

        return {
          id: caId,
          subject: subjectName,
          serialNumber: certMetadata.serialNumber,
          notBefore: notBefore.toISOString(),
          notAfter: notAfter.toISOString(),
          certificatePem: certificatePem,
          status: 'active' as const,
        };
      } catch (error) {
        logger.error({ error, caId }, 'Failed to create CA');

        // Log failure to audit log
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'ca.create',
          entityType: 'ca',
          entityId: caId,
          status: 'failure',
          details: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            subject: formatDN({
              CN: input.subject.commonName,
              O: input.subject.organization,
              OU: input.subject.organizationalUnit,
              C: input.subject.country,
              ST: input.subject.state,
              L: input.subject.locality,
            }),
          }),
          ipAddress: ctx.req.ip,
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create CA: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  revoke: publicProcedure
    .input(revokeCaSchema)
    .mutation(async ({ ctx, input }) => {
      // Retrieve CA from database
      const ca = await ctx.db
        .select()
        .from(certificateAuthorities)
        .where(eq(certificateAuthorities.id, input.id))
        .limit(1);

      if (!ca || ca.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `CA with ID ${input.id} not found`,
        });
      }

      const caRecord = ca[0];

      // Validate CA is not already revoked
      if (caRecord.status === 'revoked') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'CA is already revoked',
        });
      }

      const revocationDate = new Date();

      try {
        // Update CA status to revoked
        await ctx.db
          .update(certificateAuthorities)
          .set({
            status: 'revoked',
            revocationDate: revocationDate,
            revocationReason: input.reason,
            updatedAt: new Date(),
          })
          .where(eq(certificateAuthorities.id, input.id));

        // Optional: Cascade revocation to all active certificates issued by this CA
        // This is controlled by the task requirements, implementing as optional
        const shouldCascade = true; // Could be made configurable via input parameter

        let revokedCertCount = 0;
        if (shouldCascade) {
          // Get all active certificates issued by this CA
          const activeCerts = await ctx.db
            .select()
            .from(certificates)
            .where(and(eq(certificates.caId, input.id), eq(certificates.status, 'active'))!);

          // Revoke each certificate
          for (const cert of activeCerts) {
            await ctx.db
              .update(certificates)
              .set({
                status: 'revoked',
                revocationDate: revocationDate,
                revocationReason: 'caCompromise',
                updatedAt: new Date(),
              })
              .where(eq(certificates.id, cert.id));

            revokedCertCount++;
          }
        }

        // Generate CRL including all revoked certificates
        // Note: Full CRL generation with KMS signing will be implemented in a future enhancement
        // For now, we create a CRL record in the database
        const revokedCerts = await ctx.db
          .select()
          .from(certificates)
          .where(and(eq(certificates.caId, input.id), eq(certificates.status, 'revoked'))!);

        // Get the latest CRL number for this CA
        const latestCrl = await ctx.db
          .select()
          .from(crls)
          .where(eq(crls.caId, input.id))
          .orderBy(desc(crls.crlNumber))
          .limit(1);

        const nextCrlNumber = latestCrl.length > 0 ? latestCrl[0].crlNumber + 1 : 1;

        // Create CRL record
        // Note: CRL PEM generation requires KMS signing and will be enhanced later
        const crlId = randomUUID();
        const thisUpdate = new Date();
        const nextUpdate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await ctx.db.insert(crls).values({
          id: crlId,
          caId: input.id,
          crlNumber: nextCrlNumber,
          thisUpdate: thisUpdate,
          nextUpdate: nextUpdate,
          crlPem: '', // TODO: Generate actual CRL PEM with KMS signing
          revokedCount: revokedCerts.length,
          createdAt: new Date(),
        });

        // Create audit log entry
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'ca.revoke',
          entityType: 'ca',
          entityId: input.id,
          status: 'success',
          details: JSON.stringify({
            reason: input.reason,
            details: input.details,
            cascadeRevoked: revokedCertCount,
            crlGenerated: true,
            crlId: crlId,
            crlNumber: nextCrlNumber,
          }),
          ipAddress: ctx.req.ip,
        });

        logger.info(
          { caId: input.id, reason: input.reason, cascadeRevoked: revokedCertCount },
          'CA revoked successfully',
        );

        return {
          success: true,
          caId: input.id,
          revocationDate: revocationDate.toISOString(),
          reason: input.reason,
          cascadeRevokedCount: revokedCertCount,
          crlGenerated: true,
          crlId: crlId,
        };
      } catch (error) {
        logger.error({ error, caId: input.id }, 'Failed to revoke CA');

        // Log failure to audit log
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'ca.revoke',
          entityType: 'ca',
          entityId: input.id,
          status: 'failure',
          details: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            reason: input.reason,
          }),
          ipAddress: ctx.req.ip,
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to revoke CA: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  delete: publicProcedure
    .input(deleteCaSchema)
    .mutation(async ({ ctx, input }) => {
      // Retrieve CA from database
      const ca = await ctx.db
        .select()
        .from(certificateAuthorities)
        .where(eq(certificateAuthorities.id, input.id))
        .limit(1);

      if (!ca || ca.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `CA with ID ${input.id} not found`,
        });
      }

      const caRecord = ca[0];
      const now = new Date();

      // Validate CA is revoked or expired
      const isExpired = now > caRecord.notAfter;
      const isRevoked = caRecord.status === 'revoked';

      if (!isRevoked && !isExpired) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'CA must be revoked or expired before deletion',
        });
      }

      // Validate no active certificates exist
      const activeCerts = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(certificates)
        .where(and(eq(certificates.caId, input.id), eq(certificates.status, 'active'))!);

      const activeCertCount = Number(activeCerts[0]?.count || 0);
      if (activeCertCount > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot delete CA with ${activeCertCount} active certificate(s). Revoke all certificates first.`,
        });
      }

      try {
        // Create audit entry before deletion (audit logs are preserved)
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'ca.delete',
          entityType: 'ca',
          entityId: input.id,
          status: 'success',
          details: JSON.stringify({
            subjectDn: caRecord.subjectDn,
            serialNumber: caRecord.serialNumber,
            kmsKeyId: caRecord.kmsKeyId,
            destroyKey: input.destroyKey,
            wasRevoked: isRevoked,
            wasExpired: isExpired,
          }),
          ipAddress: ctx.req.ip,
        });

        // Optional: Destroy KMS key
        let keyDestroyed = false;
        if (input.destroyKey) {
          try {
            const kmsService = getKMSService();
            // Get the KMS key ID from the CA record
            const kmsKeyId = caRecord.kmsKeyId;

            // Destroy the key pair in KMS
            // Note: KMS requires revocation before destruction
            try {
              await kmsService.revokeKey(kmsKeyId, 'CA deleted', input.id);
            } catch (revokeError) {
              // Key might already be revoked, continue with destruction
              logger.warn({ kmsKeyId, error: revokeError }, 'Key revocation failed, may already be revoked');
            }

            await kmsService.destroyKey(kmsKeyId, input.id);
            keyDestroyed = true;
            logger.info({ kmsKeyId, caId: input.id }, 'KMS key destroyed');
          } catch (kmsError) {
            logger.error({ error: kmsError, caId: input.id }, 'Failed to destroy KMS key');
            // Continue with CA deletion even if KMS key destruction fails
            // Log the error but don't throw
          }
        }

        // Clean up orphaned CRLs
        const deletedCrls = await ctx.db
          .delete(crls)
          .where(eq(crls.caId, input.id))
          .returning({ id: crls.id });

        // Delete CA record from database
        // Note: Certificates are cascade deleted due to foreign key constraint
        await ctx.db
          .delete(certificateAuthorities)
          .where(eq(certificateAuthorities.id, input.id));

        logger.info(
          { caId: input.id, keyDestroyed, crlsDeleted: deletedCrls.length },
          'CA deleted successfully',
        );

        return {
          success: true,
          caId: input.id,
          keyDestroyed,
          crlsDeleted: deletedCrls.length,
        };
      } catch (error) {
        logger.error({ error, caId: input.id }, 'Failed to delete CA');

        // Log failure to audit log
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'ca.delete',
          entityType: 'ca',
          entityId: input.id,
          status: 'failure',
          details: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
          ipAddress: ctx.req.ip,
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to delete CA: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),
});
