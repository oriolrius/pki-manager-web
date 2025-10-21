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
      const { TRPCError } = await import('@trpc/server');
      const { randomUUID } = await import('crypto');
      const { certificateAuthorities, certificates, auditLog } = await import('../../db/schema.js');
      const { getKMSService } = await import('../../kms/service.js');
      const { formatDN } = await import('../../crypto/dn.js');
      const { parseCertificate } = await import('../../crypto/index.js');
      const { logger } = await import('../../lib/logger.js');
      const { eq } = await import('drizzle-orm');

      // Fetch original certificate
      const originalCertResult = await ctx.db
        .select()
        .from(certificates)
        .where(eq(certificates.id, input.id))
        .limit(1);

      if (!originalCertResult || originalCertResult.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Certificate with ID ${input.id} not found`,
        });
      }

      const originalCert = originalCertResult[0];

      // Validation: Cannot renew revoked certificates
      if (originalCert.status === 'revoked') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot renew a revoked certificate',
        });
      }

      // Validation: Key reuse only if original certificate is less than 90 days old
      if (!input.generateNewKey) {
        const certAgeMs = Date.now() - originalCert.createdAt.getTime();
        const certAgeDays = certAgeMs / (1000 * 60 * 60 * 24);
        if (certAgeDays >= 90) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Key reuse is only allowed for certificates less than 90 days old',
          });
        }
      }

      // Retrieve CA from database
      const ca = await ctx.db
        .select()
        .from(certificateAuthorities)
        .where(eq(certificateAuthorities.id, originalCert.caId))
        .limit(1);

      if (!ca || ca.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `CA with ID ${originalCert.caId} not found`,
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

      const newCertId = randomUUID();
      const kmsService = getKMSService();

      try {
        // Parse original certificate to extract metadata
        const originalParsed = parseCertificate(originalCert.certificatePem, 'PEM');

        // Determine subject DN (use updated subject if provided, otherwise copy from original)
        let subjectDN;
        if (input.updateInfo && input.subject) {
          subjectDN = {
            CN: input.subject.commonName,
            O: input.subject.organization,
            OU: input.subject.organizationalUnit,
            C: input.subject.country,
            ST: input.subject.state,
            L: input.subject.locality,
          };
        } else {
          subjectDN = originalParsed.subject;
        }

        // Determine SANs (use updated SANs if provided, otherwise copy from original)
        let sanDns = input.updateInfo && input.sanDns !== undefined ? input.sanDns :
                     (originalCert.sanDns ? JSON.parse(originalCert.sanDns) : null);
        let sanIp = input.updateInfo && input.sanIp !== undefined ? input.sanIp :
                    (originalCert.sanIp ? JSON.parse(originalCert.sanIp) : null);
        let sanEmail = input.updateInfo && input.sanEmail !== undefined ? input.sanEmail :
                       (originalCert.sanEmail ? JSON.parse(originalCert.sanEmail) : null);

        // Determine validity days (use provided value or default to original certificate's validity period)
        const validityDays = input.validityDays ||
          Math.ceil((originalCert.notAfter.getTime() - originalCert.notBefore.getTime()) / (1000 * 60 * 60 * 24));

        let kmsKeyId: string;
        let publicKeyId: string;

        if (input.generateNewKey) {
          // Generate new key pair in KMS
          logger.info({ newCertId, originalCertId: input.id }, 'Creating new key pair for certificate renewal');

          // Determine key size from original certificate
          // For simplicity, defaulting to RSA-2048. In production, you'd extract this from the original cert
          const keyPair = await kmsService.createKeyPair({
            sizeInBits: 2048,
            tags: [],
            purpose: 'certificate',
            entityId: newCertId,
          });

          kmsKeyId = keyPair.privateKeyId;
          publicKeyId = keyPair.publicKeyId;
        } else {
          // Reuse existing key pair
          logger.info({ newCertId, originalCertId: input.id }, 'Reusing existing key pair for certificate renewal');

          if (!originalCert.kmsKeyId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Original certificate has no associated KMS key to reuse',
            });
          }

          kmsKeyId = originalCert.kmsKeyId;

          // Get the public key ID from KMS
          // Note: This assumes the KMS service has a method to get public key from private key
          // In production, you might need to store the public key ID alongside the private key ID
          publicKeyId = kmsKeyId.replace('-private', '-public'); // Simplified assumption
        }

        const subjectName = formatDN(subjectDN);
        logger.info({ newCertId, subjectName, caId: originalCert.caId }, 'Signing renewed certificate via KMS');

        const certInfo = await kmsService.signCertificate({
          publicKeyId: publicKeyId,
          issuerPrivateKeyId: caRecord.kmsKeyId,
          subjectName: subjectName,
          daysValid: validityDays,
          tags: [],
          entityId: newCertId,
        });

        // Convert certificate data from hex to PEM
        const certDataHex = certInfo.certificateData;
        const certDataBuffer = Buffer.from(certDataHex, 'hex');
        const certBase64 = certDataBuffer.toString('base64');
        const certificatePem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;

        // Parse new certificate to extract metadata
        const certMetadata = parseCertificate(certificatePem, 'PEM');

        // Store new certificate in database with renewal chain link
        await ctx.db.insert(certificates).values({
          id: newCertId,
          caId: originalCert.caId,
          subjectDn: subjectName,
          serialNumber: certMetadata.serialNumber,
          certificateType: originalCert.certificateType,
          notBefore: certMetadata.validity.notBefore,
          notAfter: certMetadata.validity.notAfter,
          certificatePem: certificatePem,
          kmsKeyId: input.generateNewKey ? kmsKeyId : null,
          status: 'active',
          sanDns: sanDns ? JSON.stringify(sanDns) : null,
          sanIp: sanIp ? JSON.stringify(sanIp) : null,
          sanEmail: sanEmail ? JSON.stringify(sanEmail) : null,
          renewedFromId: input.id, // Link to original certificate
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Optionally revoke the original certificate
        if (input.revokeOriginal) {
          await ctx.db
            .update(certificates)
            .set({
              status: 'revoked',
              revocationDate: new Date(),
              revocationReason: 'superseded',
              updatedAt: new Date(),
            })
            .where(eq(certificates.id, input.id));

          logger.info({ originalCertId: input.id }, 'Original certificate revoked (superseded by renewal)');
        }

        // Create audit log entry for renewal
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.renew',
          entityType: 'certificate',
          entityId: newCertId,
          status: 'success',
          details: JSON.stringify({
            originalCertId: input.id,
            caId: originalCert.caId,
            certificateType: originalCert.certificateType,
            subject: subjectName,
            validityDays: validityDays,
            serialNumber: certMetadata.serialNumber,
            kmsKeyId: kmsKeyId,
            generateNewKey: input.generateNewKey,
            updateInfo: input.updateInfo,
            revokeOriginal: input.revokeOriginal,
            sanDns: sanDns,
            sanIp: sanIp,
            sanEmail: sanEmail,
          }),
          ipAddress: ctx.req.ip,
        });

        logger.info({ newCertId, originalCertId: input.id }, 'Certificate renewed successfully');

        return {
          id: newCertId,
          subject: subjectName,
          serialNumber: certMetadata.serialNumber,
          notBefore: certMetadata.validity.notBefore.toISOString(),
          notAfter: certMetadata.validity.notAfter.toISOString(),
          certificatePem: certificatePem,
          status: 'active' as const,
          renewedFromId: input.id,
        };
      } catch (error) {
        logger.error({ error, newCertId, originalCertId: input.id }, 'Failed to renew certificate');

        // Log failure to audit log
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.renew',
          entityType: 'certificate',
          entityId: newCertId,
          status: 'failure',
          details: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            originalCertId: input.id,
            caId: originalCert.caId,
            certificateType: originalCert.certificateType,
          }),
          ipAddress: ctx.req.ip,
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to renew certificate: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  revoke: publicProcedure
    .input(revokeCertificateSchema)
    .mutation(async ({ ctx, input }) => {
      const { TRPCError } = await import('@trpc/server');
      const { randomUUID } = await import('crypto');
      const { certificates, auditLog } = await import('../../db/schema.js');
      const { logger } = await import('../../lib/logger.js');
      const { eq } = await import('drizzle-orm');

      // Fetch certificate from database
      const certResult = await ctx.db
        .select()
        .from(certificates)
        .where(eq(certificates.id, input.id))
        .limit(1);

      if (!certResult || certResult.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Certificate with ID ${input.id} not found`,
        });
      }

      const cert = certResult[0];

      // Validation: Cannot revoke already revoked certificate
      if (cert.status === 'revoked') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Certificate is already revoked',
        });
      }

      // Determine effective date (default to now if not provided)
      const effectiveDate = input.effectiveDate
        ? new Date(input.effectiveDate * 1000)
        : new Date();

      // Validate effective date is between certificate issuance and now
      const now = new Date();
      if (effectiveDate < cert.notBefore) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Effective date cannot be before certificate issuance date',
        });
      }

      if (effectiveDate > now) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Effective date cannot be in the future',
        });
      }

      try {
        // Update certificate status to revoked
        await ctx.db
          .update(certificates)
          .set({
            status: 'revoked',
            revocationDate: effectiveDate,
            revocationReason: input.details
              ? `${input.reason}: ${input.details}`
              : input.reason,
            updatedAt: new Date(),
          })
          .where(eq(certificates.id, input.id));

        logger.info(
          {
            certId: input.id,
            reason: input.reason,
            effectiveDate: effectiveDate.toISOString()
          },
          'Certificate revoked successfully'
        );

        // Create audit log entry
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.revoke',
          entityType: 'certificate',
          entityId: input.id,
          status: 'success',
          details: JSON.stringify({
            caId: cert.caId,
            serialNumber: cert.serialNumber,
            reason: input.reason,
            effectiveDate: effectiveDate.toISOString(),
            details: input.details,
            generateCrl: input.generateCrl,
          }),
          ipAddress: ctx.req.ip,
        });

        // TODO: Optional CRL generation (will be implemented in task-022)
        if (input.generateCrl) {
          logger.info({ caId: cert.caId }, 'CRL generation requested (not yet implemented)');
        }

        return {
          id: input.id,
          status: 'revoked' as const,
          revocationDate: effectiveDate.toISOString(),
          revocationReason: input.details
            ? `${input.reason}: ${input.details}`
            : input.reason,
        };
      } catch (error) {
        logger.error({ error, certId: input.id }, 'Failed to revoke certificate');

        // Log failure to audit log
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.revoke',
          entityType: 'certificate',
          entityId: input.id,
          status: 'failure',
          details: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            caId: cert.caId,
            serialNumber: cert.serialNumber,
            reason: input.reason,
          }),
          ipAddress: ctx.req.ip,
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to revoke certificate: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
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
