import { z } from 'zod';
import { router, publicProcedure } from '../init.js';
import {
  listCertificatesSchema,
  getCertificateSchema,
  createCertificateSchema,
  renewCertificateSchema,
  revokeCertificateSchema,
  deleteCertificateSchema,
  certificateTypeSchema,
  certificateStatusSchema,
} from '../schemas.js';

export const certificateRouter = router({
  list: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/certificates',
        tags: ['certificates'],
        summary: 'List certificates',
        description: 'Retrieve a paginated list of certificates with optional filtering, searching, and sorting capabilities.',
      },
    })
    .input(listCertificatesSchema)
    .output(
      z.object({
        items: z.array(
          z.object({
            id: z.string(),
            caId: z.string(),
            subjectDn: z.string(),
            serialNumber: z.string(),
            certificateType: certificateTypeSchema,
            notBefore: z.date(),
            notAfter: z.date(),
            certificatePem: z.string(),
            kmsKeyId: z.string().nullable(),
            status: certificateStatusSchema,
            revocationDate: z.date().nullable(),
            revocationReason: z.string().nullable(),
            sanDns: z.array(z.string()).nullable(),
            sanIp: z.array(z.string()).nullable(),
            sanEmail: z.array(z.string()).nullable(),
            renewedFromId: z.string().nullable(),
            createdAt: z.date(),
            updatedAt: z.date(),
            expiryStatus: z.enum(['active', 'expired', 'expiring_soon']),
          })
        ),
        totalCount: z.number(),
        limit: z.number(),
        offset: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { eq, and, or, gte, lte, like, sql } = await import('drizzle-orm');
      const { certificates } = await import('../../db/schema.js');

      // Default input if not provided
      const params = input || {
        sortBy: 'createdAt' as const,
        sortOrder: 'desc' as const,
        limit: 50,
        offset: 0,
      };
      const {
        caId,
        status,
        certificateType,
        domain,
        expiryStatus,
        issuedAfter,
        issuedBefore,
        expiresAfter,
        expiresBefore,
        search,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        limit = 50,
        offset = 0,
      } = params;

      // Build where conditions
      const whereConditions = [];

      // Basic filters
      if (caId) {
        whereConditions.push(eq(certificates.caId, caId));
      }
      if (status) {
        whereConditions.push(eq(certificates.status, status));
      }
      if (certificateType) {
        whereConditions.push(eq(certificates.certificateType, certificateType));
      }

      // Date range filters
      if (issuedAfter) {
        whereConditions.push(gte(certificates.notBefore, issuedAfter));
      }
      if (issuedBefore) {
        whereConditions.push(lte(certificates.notBefore, issuedBefore));
      }
      if (expiresAfter) {
        whereConditions.push(gte(certificates.notAfter, expiresAfter));
      }
      if (expiresBefore) {
        whereConditions.push(lte(certificates.notAfter, expiresBefore));
      }

      // Expiry status filter (computed dynamically)
      if (expiryStatus) {
        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        if (expiryStatus === 'expired') {
          whereConditions.push(lte(certificates.notAfter, now));
        } else if (expiryStatus === 'expiring_soon') {
          whereConditions.push(
            and(
              gte(certificates.notAfter, now),
              lte(certificates.notAfter, thirtyDaysFromNow)
            )!
          );
        } else if (expiryStatus === 'active') {
          whereConditions.push(gte(certificates.notAfter, thirtyDaysFromNow));
        }
      }

      // Domain filter (searches in CN and SANs)
      if (domain) {
        whereConditions.push(
          or(
            like(certificates.subjectDn, `%CN=${domain}%`),
            like(certificates.sanDns, `%${domain}%`)
          )!
        );
      }

      // Search functionality (CN, subject, SAN, serial)
      if (search) {
        whereConditions.push(
          or(
            like(certificates.subjectDn, `%${search}%`),
            like(certificates.serialNumber, `%${search}%`),
            like(certificates.sanDns, `%${search}%`),
            like(certificates.sanIp, `%${search}%`),
            like(certificates.sanEmail, `%${search}%`)
          )!
        );
      }

      // Build final where clause
      const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

      // Get total count
      const countResult = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(certificates)
        .where(whereClause);
      const totalCount = countResult[0]?.count || 0;

      // Build order by clause
      const orderByColumn = certificates[sortBy as keyof typeof certificates];
      const orderByClause = sortOrder === 'asc'
        ? sql`${orderByColumn} ASC`
        : sql`${orderByColumn} DESC`;

      // Execute query with pagination
      const results = await ctx.db
        .select()
        .from(certificates)
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      // Compute expiry status for each result
      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const formattedResults = results.map((cert) => {
        let computedExpiryStatus: 'active' | 'expired' | 'expiring_soon';
        if (cert.notAfter < now) {
          computedExpiryStatus = 'expired';
        } else if (cert.notAfter <= thirtyDaysFromNow) {
          computedExpiryStatus = 'expiring_soon';
        } else {
          computedExpiryStatus = 'active';
        }

        return {
          ...cert,
          expiryStatus: computedExpiryStatus,
          sanDns: cert.sanDns ? JSON.parse(cert.sanDns) : null,
          sanIp: cert.sanIp ? JSON.parse(cert.sanIp) : null,
          sanEmail: cert.sanEmail ? JSON.parse(cert.sanEmail) : null,
        };
      });

      return {
        items: formattedResults,
        totalCount,
        limit,
        offset,
      };
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
      const { TRPCError } = await import('@trpc/server');
      const { randomUUID } = await import('crypto');
      const { certificateAuthorities, certificates, auditLog } = await import('../../db/schema.js');
      const { getKMSService } = await import('../../kms/service.js');
      const { formatDN } = await import('../../crypto/dn.js');
      const { parseCertificate } = await import('../../crypto/index.js');
      const {
        validateDomainName,
        validateServerSANs,
        validateCertificateValidity,
      } = await import('../../crypto/validation.js');
      const { logger } = await import('../../lib/logger.js');
      const { eq } = await import('drizzle-orm');

      // Validate certificate type (only server supported in this task)
      if (input.certificateType !== 'server') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only server certificate type is supported in this endpoint',
        });
      }

      // Validate validity period (max 825 days for server certificates)
      const validityCheck = validateCertificateValidity(input.validityDays, 825);
      if (!validityCheck.valid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: validityCheck.error || 'Invalid validity period',
        });
      }

      // Validate domain name in CN for server certificates
      const cnValidation = validateDomainName(input.subject.commonName);
      if (!cnValidation.valid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid common name: ${cnValidation.error}`,
        });
      }

      // Validate SANs
      const sansValidation = validateServerSANs(input.sanDns, input.sanIp);
      if (!sansValidation.valid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid SANs: ${sansValidation.errors.join(', ')}`,
        });
      }

      // Retrieve CA from database
      const ca = await ctx.db
        .select()
        .from(certificateAuthorities)
        .where(eq(certificateAuthorities.id, input.caId))
        .limit(1);

      if (!ca || ca.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `CA with ID ${input.caId} not found`,
        });
      }

      const caRecord = ca[0];

      // Validate CA is active and not expired
      const now = new Date();
      if (caRecord.status !== 'active') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `CA is not active (status: ${caRecord.status})`,
        });
      }

      if (now > caRecord.notAfter) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'CA certificate has expired',
        });
      }

      const certId = randomUUID();
      const kmsService = getKMSService();

      try {
        // Convert API schema DN to crypto DN format
        const subjectDN = {
          CN: input.subject.commonName,
          O: input.subject.organization,
          OU: input.subject.organizationalUnit,
          C: input.subject.country,
          ST: input.subject.state,
          L: input.subject.locality,
        };

        // Determine key size from algorithm
        let keySizeInBits = 2048;
        if (input.keyAlgorithm === 'RSA-4096') {
          keySizeInBits = 4096;
        }

        // Generate key pair in KMS for the certificate
        logger.info({ certId, keyAlgorithm: input.keyAlgorithm }, 'Creating certificate key pair in KMS');
        const keyPair = await kmsService.createKeyPair({
          sizeInBits: keySizeInBits,
          tags: input.tags || [],
          purpose: 'certificate',
          entityId: certId,
        });

        // Use KMS to sign the certificate
        // NOTE: This uses KMS certify operation which may have limited extension support
        // For server certificates, we need:
        // - Basic Constraints (CA=false)
        // - Key Usage (digitalSignature, keyEncipherment)
        // - Extended Key Usage (serverAuth)
        // - Subject Alternative Names (from input.sanDns, input.sanIp)
        // - CRL Distribution Point (requires CRL infrastructure - future task)
        //
        // The KMS certify operation provides basic certificate generation.
        // Full extension support would require either:
        // 1. Enhanced KMS extension support
        // 2. Local certificate generation with HSM signing
        // This is documented as a limitation and can be enhanced in future iterations.

        const subjectName = formatDN(subjectDN);
        logger.info({ certId, subjectName, caId: input.caId }, 'Signing certificate via KMS');

        const certInfo = await kmsService.signCertificate({
          publicKeyId: keyPair.publicKeyId,
          issuerPrivateKeyId: caRecord.kmsKeyId,
          subjectName: subjectName,
          daysValid: input.validityDays,
          tags: input.tags || [],
          entityId: certId,
        });

        // Convert certificate data from hex to PEM
        const certDataHex = certInfo.certificateData;
        const certDataBuffer = Buffer.from(certDataHex, 'hex');
        const certBase64 = certDataBuffer.toString('base64');
        const certificatePem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;

        // Parse certificate to extract metadata
        const certMetadata = parseCertificate(certificatePem, 'PEM');

        // Store certificate in database
        await ctx.db.insert(certificates).values({
          id: certId,
          caId: input.caId,
          subjectDn: subjectName,
          serialNumber: certMetadata.serialNumber,
          certificateType: input.certificateType,
          notBefore: certMetadata.validity.notBefore,
          notAfter: certMetadata.validity.notAfter,
          certificatePem: certificatePem,
          kmsKeyId: keyPair.privateKeyId,
          status: 'active',
          sanDns: input.sanDns ? JSON.stringify(input.sanDns) : null,
          sanIp: input.sanIp ? JSON.stringify(input.sanIp) : null,
          sanEmail: input.sanEmail ? JSON.stringify(input.sanEmail) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Create audit log entry
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.issue',
          entityType: 'certificate',
          entityId: certId,
          status: 'success',
          details: JSON.stringify({
            caId: input.caId,
            certificateType: input.certificateType,
            subject: subjectName,
            keyAlgorithm: input.keyAlgorithm,
            validityDays: input.validityDays,
            serialNumber: certMetadata.serialNumber,
            kmsKeyId: keyPair.privateKeyId,
            sanDns: input.sanDns,
            sanIp: input.sanIp,
            sanEmail: input.sanEmail,
          }),
          ipAddress: ctx.req.ip,
        });

        logger.info({ certId, subjectName, caId: input.caId }, 'Certificate issued successfully');

        return {
          id: certId,
          subject: subjectName,
          serialNumber: certMetadata.serialNumber,
          notBefore: certMetadata.validity.notBefore.toISOString(),
          notAfter: certMetadata.validity.notAfter.toISOString(),
          certificatePem: certificatePem,
          status: 'active' as const,
        };
      } catch (error) {
        logger.error({ error, certId }, 'Failed to issue certificate');

        // Log failure to audit log
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.issue',
          entityType: 'certificate',
          entityId: certId,
          status: 'failure',
          details: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            caId: input.caId,
            certificateType: input.certificateType,
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
          message: `Failed to issue certificate: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
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
