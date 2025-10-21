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
    .meta({
      openapi: {
        method: 'GET',
        path: '/certificates/{id}',
        tags: ['certificates'],
        summary: 'Get certificate details',
        description: 'Retrieve comprehensive details about a specific certificate including all fields, extensions, fingerprints, and status information.',
      },
    })
    .input(getCertificateSchema)
    .output(
      z.object({
        // Basic fields
        id: z.string(),
        caId: z.string(),
        serialNumber: z.string(),
        certificateType: certificateTypeSchema,
        status: certificateStatusSchema,

        // Distinguished Names
        subjectDn: z.string(),
        subject: z.object({
          commonName: z.string(),
          organization: z.string(),
          organizationalUnit: z.string().optional(),
          country: z.string(),
          state: z.string().optional(),
          locality: z.string().optional(),
        }),
        issuerDn: z.string(),
        issuer: z.object({
          commonName: z.string().optional(),
          organization: z.string().optional(),
          organizationalUnit: z.string().optional(),
          country: z.string().optional(),
          state: z.string().optional(),
          locality: z.string().optional(),
        }),

        // Validity
        notBefore: z.date(),
        notAfter: z.date(),
        validityStatus: z.enum(['valid', 'expired', 'not_yet_valid']),
        remainingDays: z.number().nullable(),

        // Key Usage
        keyUsage: z
          .object({
            digitalSignature: z.boolean().optional(),
            nonRepudiation: z.boolean().optional(),
            keyEncipherment: z.boolean().optional(),
            dataEncipherment: z.boolean().optional(),
            keyAgreement: z.boolean().optional(),
            keyCertSign: z.boolean().optional(),
            cRLSign: z.boolean().optional(),
            encipherOnly: z.boolean().optional(),
            decipherOnly: z.boolean().optional(),
          })
          .nullable(),

        // Extended Key Usage
        extendedKeyUsage: z.array(z.string()).nullable(),

        // Subject Alternative Names
        sanDns: z.array(z.string()).nullable(),
        sanIp: z.array(z.string()).nullable(),
        sanEmail: z.array(z.string()).nullable(),

        // Basic Constraints
        basicConstraints: z
          .object({
            cA: z.boolean(),
            pathLenConstraint: z.number().nullable(),
          })
          .nullable(),

        // Fingerprints
        fingerprints: z.object({
          sha256: z.string(),
          sha1: z.string(),
        }),

        // CA Information
        issuingCA: z.object({
          id: z.string(),
          subjectDn: z.string(),
          serialNumber: z.string(),
        }),

        // Certificate data
        certificatePem: z.string(),
        kmsKeyId: z.string().nullable(),

        // Revocation info
        revocationDate: z.date().nullable(),
        revocationReason: z.string().nullable(),

        // Renewal chain
        renewedFromId: z.string().nullable(),
        renewedTo: z
          .array(
            z.object({
              id: z.string(),
              serialNumber: z.string(),
              createdAt: z.date(),
            })
          )
          .nullable(),

        // Timestamps
        createdAt: z.date(),
        updatedAt: z.date(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { TRPCError } = await import('@trpc/server');
      const { eq } = await import('drizzle-orm');
      const { certificates, certificateAuthorities } = await import('../../db/schema.js');
      const forge = await import('node-forge');
      const { parseCertificate } = await import('../../crypto/index.js');

      // Query certificate with CA join
      const result = await ctx.db
        .select({
          certificate: certificates,
          ca: certificateAuthorities,
        })
        .from(certificates)
        .leftJoin(certificateAuthorities, eq(certificates.caId, certificateAuthorities.id))
        .where(eq(certificates.id, input.id))
        .limit(1);

      if (!result || result.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Certificate with ID ${input.id} not found`,
        });
      }

      const { certificate, ca } = result[0];

      if (!ca) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Certificate has no associated CA',
        });
      }

      // Parse certificate to extract details
      const parsed = parseCertificate(certificate.certificatePem, 'PEM');

      // Parse certificate using node-forge for extensions
      const forgeCert = forge.default.pki.certificateFromPem(certificate.certificatePem);

      // Calculate fingerprints
      const certDer = forge.default.asn1.toDer(
        forge.default.pki.certificateToAsn1(forgeCert)
      ).getBytes();
      const sha256Hash = forge.default.md.sha256.create();
      sha256Hash.update(certDer);
      const sha256Fingerprint = sha256Hash
        .digest()
        .toHex()
        .toUpperCase()
        .match(/.{1,2}/g)!
        .join(':');

      const sha1Hash = forge.default.md.sha1.create();
      sha1Hash.update(certDer);
      const sha1Fingerprint = sha1Hash
        .digest()
        .toHex()
        .toUpperCase()
        .match(/.{1,2}/g)!
        .join(':');

      // Parse Key Usage extension
      let keyUsage: any = null;
      const keyUsageExt = forgeCert.extensions.find((ext: any) => ext.name === 'keyUsage');
      if (keyUsageExt) {
        keyUsage = {
          digitalSignature: keyUsageExt.digitalSignature || undefined,
          nonRepudiation: keyUsageExt.nonRepudiation || undefined,
          keyEncipherment: keyUsageExt.keyEncipherment || undefined,
          dataEncipherment: keyUsageExt.dataEncipherment || undefined,
          keyAgreement: keyUsageExt.keyAgreement || undefined,
          keyCertSign: keyUsageExt.keyCertSign || undefined,
          cRLSign: keyUsageExt.cRLSign || undefined,
          encipherOnly: keyUsageExt.encipherOnly || undefined,
          decipherOnly: keyUsageExt.decipherOnly || undefined,
        };
      }

      // Parse Extended Key Usage extension
      let extendedKeyUsage: string[] | null = null;
      const ekuExt = forgeCert.extensions.find((ext: any) => ext.name === 'extKeyUsage');
      if (ekuExt) {
        extendedKeyUsage = [];
        if (ekuExt.serverAuth) extendedKeyUsage.push('serverAuth');
        if (ekuExt.clientAuth) extendedKeyUsage.push('clientAuth');
        if (ekuExt.codeSigning) extendedKeyUsage.push('codeSigning');
        if (ekuExt.emailProtection) extendedKeyUsage.push('emailProtection');
        if (ekuExt.timeStamping) extendedKeyUsage.push('timeStamping');
      }

      // Parse Basic Constraints extension
      let basicConstraints: any = null;
      const bcExt = forgeCert.extensions.find((ext: any) => ext.name === 'basicConstraints');
      if (bcExt) {
        basicConstraints = {
          cA: bcExt.cA || false,
          pathLenConstraint: bcExt.pathLenConstraint ?? null,
        };
      }

      // Compute validity status
      const now = new Date();
      let validityStatus: 'valid' | 'expired' | 'not_yet_valid';
      let remainingDays: number | null = null;

      if (now < parsed.validity.notBefore) {
        validityStatus = 'not_yet_valid';
      } else if (now > parsed.validity.notAfter) {
        validityStatus = 'expired';
        remainingDays = 0;
      } else {
        validityStatus = 'valid';
        const diffMs = parsed.validity.notAfter.getTime() - now.getTime();
        remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      }

      // Query for certificates renewed from this one
      const renewedCerts = await ctx.db
        .select({
          id: certificates.id,
          serialNumber: certificates.serialNumber,
          createdAt: certificates.createdAt,
        })
        .from(certificates)
        .where(eq(certificates.renewedFromId, certificate.id));

      // Convert subject to the expected format
      const subject = {
        commonName: parsed.subject.CN || '',
        organization: parsed.subject.O || '',
        organizationalUnit: parsed.subject.OU,
        country: parsed.subject.C || '',
        state: parsed.subject.ST,
        locality: parsed.subject.L,
      };

      // Convert issuer to the expected format
      const issuer = {
        commonName: parsed.issuer.CN,
        organization: parsed.issuer.O,
        organizationalUnit: parsed.issuer.OU,
        country: parsed.issuer.C,
        state: parsed.issuer.ST,
        locality: parsed.issuer.L,
      };

      return {
        id: certificate.id,
        caId: certificate.caId,
        serialNumber: certificate.serialNumber,
        certificateType: certificate.certificateType,
        status: certificate.status,
        subjectDn: certificate.subjectDn,
        subject,
        issuerDn: ca.subjectDn,
        issuer,
        notBefore: certificate.notBefore,
        notAfter: certificate.notAfter,
        validityStatus,
        remainingDays,
        keyUsage,
        extendedKeyUsage,
        sanDns: certificate.sanDns ? JSON.parse(certificate.sanDns) : null,
        sanIp: certificate.sanIp ? JSON.parse(certificate.sanIp) : null,
        sanEmail: certificate.sanEmail ? JSON.parse(certificate.sanEmail) : null,
        basicConstraints,
        fingerprints: {
          sha256: sha256Fingerprint,
          sha1: sha1Fingerprint,
        },
        issuingCA: {
          id: ca.id,
          subjectDn: ca.subjectDn,
          serialNumber: ca.serialNumber,
        },
        certificatePem: certificate.certificatePem,
        kmsKeyId: certificate.kmsKeyId,
        revocationDate: certificate.revocationDate,
        revocationReason: certificate.revocationReason,
        renewedFromId: certificate.renewedFromId,
        renewedTo: renewedCerts.length > 0 ? renewedCerts : null,
        createdAt: certificate.createdAt,
        updatedAt: certificate.updatedAt,
      };
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
