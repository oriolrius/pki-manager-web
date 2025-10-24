import { z } from 'zod';
import { router, publicProcedure } from '../init.js';
import {
  listCertificatesSchema,
  getCertificateSchema,
  createCertificateSchema,
  renewCertificateSchema,
  revokeCertificateSchema,
  deleteCertificateSchema,
  downloadCertificateSchema,
  certificateTypeSchema,
  certificateStatusSchema,
  bulkCreateCertificatesSchema,
  bulkRevokeCertificatesSchema,
  bulkRenewCertificatesSchema,
  bulkDeleteCertificatesSchema,
  bulkDownloadCertificatesSchema,
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

      // Fetch certificate from KMS
      const { getKMSService } = await import('../../kms/service.js');
      const kmsService = getKMSService();
      const certificatePem = await kmsService.getCertificate(
        certificate.kmsCertificateId,
        certificate.id
      );

      // Parse certificate to extract details
      const parsed = parseCertificate(certificatePem, 'PEM');

      // Parse certificate using node-forge for extensions
      const forgeCert = forge.default.pki.certificateFromPem(certificatePem);

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
        certificatePem: certificatePem,
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

      // Type-specific validation
      switch (input.certificateType) {
        case 'server':
          // Validate validity period (max 825 days for server certificates)
          const serverValidityCheck = validateCertificateValidity(input.validityDays, 825);
          if (!serverValidityCheck.valid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: serverValidityCheck.error || 'Invalid validity period',
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

          // Validate SANs for server certificates
          const sansValidation = validateServerSANs(input.sanDns, input.sanIp);
          if (!sansValidation.valid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Invalid SANs: ${sansValidation.errors.join(', ')}`,
            });
          }
          break;

        case 'client':
          // Validate validity period (default 365 days, max 2 years for client certificates)
          const clientValidityCheck = validateCertificateValidity(input.validityDays, 730);
          if (!clientValidityCheck.valid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: clientValidityCheck.error || 'Invalid validity period',
            });
          }

          // Validate CN for email or username format
          const cn = input.subject.commonName;
          const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cn);
          const isUsername = /^[a-zA-Z0-9_-]+$/.test(cn);
          if (!isEmail && !isUsername) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Client certificate CN must be a valid email address or username',
            });
          }

          // Validate email SANs if provided
          if (input.sanEmail && input.sanEmail.length > 0) {
            for (const email of input.sanEmail) {
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message: `Invalid email in SANs: ${email}`,
                });
              }
            }
          }
          break;

        case 'code_signing':
          // Validate organization is provided
          if (!input.subject.organization) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Organization is required for code signing certificates',
            });
          }

          // Validate validity period (max 3 years for code signing certificates)
          const codeSignValidityCheck = validateCertificateValidity(input.validityDays, 1095);
          if (!codeSignValidityCheck.valid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: codeSignValidityCheck.error || 'Invalid validity period',
            });
          }

          // Validate minimum key strength
          if (input.keyAlgorithm === 'RSA-2048') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Code signing certificates require RSA-3072, RSA-4096, or ECDSA-P256 minimum',
            });
          }
          break;

        case 'email':
          // Validate email addresses
          const emailAddresses = input.sanEmail || [];
          if (emailAddresses.length === 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Email protection certificates require at least one email address in SANs',
            });
          }

          // Validate all emails are from the same domain
          const domains = emailAddresses.map(email => email.split('@')[1]);
          const uniqueDomains = [...new Set(domains)];
          if (uniqueDomains.length > 1) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'All email addresses must be from the same domain',
            });
          }

          // Validate validity period (max 2 years for email certificates)
          const emailValidityCheck = validateCertificateValidity(input.validityDays, 730);
          if (!emailValidityCheck.valid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: emailValidityCheck.error || 'Invalid validity period',
            });
          }
          break;

        default:
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Unsupported certificate type: ${input.certificateType}`,
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
        // - CRL Distribution Point (configured via CRL_DISTRIBUTION_URL env var)
        //
        // The KMS certify operation provides basic certificate generation.
        // Full extension support including CDP would require either:
        // 1. Enhanced KMS extension support
        // 2. Local certificate generation with HSM signing
        //
        // CDP URL configuration is available via process.env.CRL_DISTRIBUTION_URL
        // Format: http://your-domain.com/crl/{caId}.crl
        // This is documented as a limitation and can be enhanced in future iterations.

        const subjectName = formatDN(subjectDN);
        logger.info({ certId, subjectName, caId: input.caId }, 'Signing certificate via KMS');

        const certInfo = await kmsService.signCertificate({
          publicKeyId: keyPair.publicKeyId,
          issuerPrivateKeyId: caRecord.kmsKeyId,
          issuerCertificateId: caRecord.kmsCertificateId,
          issuerName: caRecord.subjectDn,
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
          kmsCertificateId: certInfo.certificateId,
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
        // Fetch original certificate from KMS
        const originalCertificatePem = await kmsService.getCertificate(
          originalCert.kmsCertificateId,
          originalCert.id
        );

        // Parse original certificate to extract metadata
        const originalParsed = parseCertificate(originalCertificatePem, 'PEM');

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
          kmsCertificateId: certInfo.certificateId,
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
      const { TRPCError } = await import('@trpc/server');
      const { randomUUID } = await import('crypto');
      const { certificates, auditLog } = await import('../../db/schema.js');
      const { getKMSService } = await import('../../kms/service.js');
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

      // Validation: Certificate must be revoked or expired > 90 days
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      const isRevoked = cert.status === 'revoked';
      const isExpiredOverNinetyDays = cert.notAfter < ninetyDaysAgo;

      if (!isRevoked && !isExpiredOverNinetyDays) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Certificate must be revoked or expired for more than 90 days before deletion',
        });
      }

      try {
        // Create audit log entry BEFORE deletion
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.delete',
          entityType: 'certificate',
          entityId: input.id,
          status: 'success',
          details: JSON.stringify({
            caId: cert.caId,
            serialNumber: cert.serialNumber,
            certificateType: cert.certificateType,
            status: cert.status,
            destroyKey: input.destroyKey,
            removeFromCrl: input.removeFromCrl,
            revocationDate: cert.revocationDate?.toISOString(),
            revocationReason: cert.revocationReason,
          }),
          ipAddress: ctx.req.ip,
        });

        // Optional: Destroy KMS key if requested
        if (input.destroyKey && cert.kmsKeyId) {
          try {
            const kmsService = getKMSService();
            await kmsService.destroyKey(cert.kmsKeyId);
            logger.info(
              { certId: input.id, kmsKeyId: cert.kmsKeyId },
              'KMS key destroyed for deleted certificate'
            );
          } catch (error) {
            logger.warn(
              { error, certId: input.id, kmsKeyId: cert.kmsKeyId },
              'Failed to destroy KMS key, continuing with certificate deletion'
            );
            // Continue with deletion even if KMS key destruction fails
          }
        }

        // Delete certificate from database
        await ctx.db
          .delete(certificates)
          .where(eq(certificates.id, input.id));

        logger.info(
          { certId: input.id, serialNumber: cert.serialNumber },
          'Certificate deleted successfully'
        );

        // TODO: Optional removal from CRL (will be implemented in task-022)
        if (input.removeFromCrl) {
          logger.info({ caId: cert.caId }, 'CRL update requested (not yet implemented)');
        }

        return {
          id: input.id,
          deleted: true,
          kmsKeyDestroyed: input.destroyKey && cert.kmsKeyId !== null,
        };
      } catch (error) {
        logger.error({ error, certId: input.id }, 'Failed to delete certificate');

        // Log failure to audit log
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.delete',
          entityType: 'certificate',
          entityId: input.id,
          status: 'failure',
          details: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            caId: cert.caId,
            serialNumber: cert.serialNumber,
          }),
          ipAddress: ctx.req.ip,
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to delete certificate: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  download: publicProcedure
    .input(downloadCertificateSchema)
    .query(async ({ ctx, input }) => {
      const { TRPCError } = await import('@trpc/server');
      const { randomUUID } = await import('crypto');
      const { certificates, certificateAuthorities, auditLog } = await import('../../db/schema.js');
      const { logger } = await import('../../lib/logger.js');
      const { eq } = await import('drizzle-orm');
      const forge = await import('node-forge');
      const { parseCertificate } = await import('../../crypto/index.js');

      // Fetch certificate from database
      const certResult = await ctx.db
        .select({
          certificate: certificates,
          ca: certificateAuthorities,
        })
        .from(certificates)
        .leftJoin(certificateAuthorities, eq(certificates.caId, certificateAuthorities.id))
        .where(eq(certificates.id, input.id))
        .limit(1);

      if (!certResult || certResult.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Certificate with ID ${input.id} not found`,
        });
      }

      const { certificate, ca } = certResult[0];

      if (!ca) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Certificate has no associated CA',
        });
      }

      // Fetch certificates from KMS
      const { getKMSService } = await import('../../kms/service.js');
      const kmsService = getKMSService();
      const certificatePem = await kmsService.getCertificate(
        certificate.kmsCertificateId,
        certificate.id
      );
      const caCertificatePem = await kmsService.getCertificate(
        ca.kmsCertificateId,
        ca.id
      );

      // Parse certificate metadata for filename
      const certMetadata = parseCertificate(certificatePem, 'PEM');
      const commonName = certMetadata.subject.CN || 'certificate';
      const serialShort = certificate.serialNumber.substring(0, 8);

      // Formats that require a private key
      const formatsRequiringKey = ['pkcs12', 'pfx', 'p12', 'jks'];
      const requiresKey = formatsRequiringKey.includes(input.format);

      // Validate password for formats that require it
      if (requiresKey && !input.password) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Password is required for ${input.format.toUpperCase()} format`,
        });
      }

      // Check if certificate has exportable key for formats that require it
      if (requiresKey && !certificate.kmsKeyId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Certificate does not have an exportable private key',
        });
      }

      let data: string;
      let mimeType: string;
      let filename: string;

      try {
        const forgeCert = forge.default.pki.certificateFromPem(certificatePem);
        const forgeCaCert = forge.default.pki.certificateFromPem(caCertificatePem);

        switch (input.format) {
          case 'pem':
          case 'crt':
            // PEM format (single certificate)
            data = certificatePem;
            mimeType = 'application/x-pem-file';
            filename = `${commonName}-${serialShort}.${input.format}`;
            break;

          case 'der':
          case 'cer':
            // DER format (binary)
            const derBytes = forge.default.asn1.toDer(
              forge.default.pki.certificateToAsn1(forgeCert)
            ).getBytes();
            data = Buffer.from(derBytes, 'binary').toString('base64');
            mimeType = 'application/x-x509-ca-cert';
            filename = `${commonName}-${serialShort}.${input.format}`;
            break;

          case 'pem-chain':
            // PEM chain format (certificate + CA)
            data = certificatePem + '\n' + caCertificatePem;
            mimeType = 'application/x-pem-file';
            filename = `${commonName}-${serialShort}-chain.pem`;
            break;

          case 'pkcs7':
          case 'p7b':
            // PKCS#7 format (certificate + CA chain, no private key)
            const p7 = forge.default.pkcs7.createSignedData();
            p7.addCertificate(forgeCert);
            p7.addCertificate(forgeCaCert);
            const p7Der = forge.default.asn1.toDer(p7.toAsn1()).getBytes();
            data = Buffer.from(p7Der, 'binary').toString('base64');
            mimeType = 'application/pkcs7-mime';
            filename = `${commonName}-${serialShort}.${input.format === 'pkcs7' ? 'p7b' : input.format}`;
            break;

          case 'pkcs12':
          case 'pfx':
          case 'p12': {
            // PKCS#12 format (certificate + private key + CA chain, password protected)
            if (!certificate.kmsKeyId) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Certificate does not have a private key',
              });
            }

            // Fetch private key from KMS
            const privateKeyPem = await kmsService.getPrivateKey(
              certificate.kmsKeyId,
              certificate.id
            );

            // Convert PEM private key to forge format
            const forgePrivateKey = forge.default.pki.privateKeyFromPem(privateKeyPem);

            // Create PKCS#12
            const p12Asn1 = forge.default.pkcs12.toPkcs12Asn1(
              forgePrivateKey,
              [forgeCert, forgeCaCert],
              input.password!,
              {
                algorithm: '3des',
                friendlyName: commonName,
              }
            );
            const p12Der = forge.default.asn1.toDer(p12Asn1).getBytes();
            data = Buffer.from(p12Der, 'binary').toString('base64');
            mimeType = 'application/x-pkcs12';
            filename = `${commonName}-${serialShort}.${input.format === 'pkcs12' ? 'p12' : input.format}`;
            break;
          }

          case 'jks': {
            // JKS (Java KeyStore) format
            if (!certificate.kmsKeyId) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Certificate does not have a private key',
              });
            }

            // Fetch private key from KMS
            const privateKeyPem = await kmsService.getPrivateKey(
              certificate.kmsKeyId,
              certificate.id
            );

            // For JKS, we need to use a Java library or convert to PKCS#12 first
            // Since node-forge doesn't support JKS directly, we'll use pkcs12 as intermediate
            // and provide instructions to convert using keytool
            // For now, we'll return PKCS#12 with instructions
            const forgePrivateKey = forge.default.pki.privateKeyFromPem(privateKeyPem);
            const p12Asn1 = forge.default.pkcs12.toPkcs12Asn1(
              forgePrivateKey,
              [forgeCert, forgeCaCert],
              input.password!,
              {
                algorithm: '3des',
                friendlyName: input.alias || commonName,
              }
            );
            const p12Der = forge.default.asn1.toDer(p12Asn1).getBytes();
            data = Buffer.from(p12Der, 'binary').toString('base64');
            mimeType = 'application/x-pkcs12';
            // Return as .p12 with note that it can be imported into JKS
            filename = `${commonName}-${serialShort}.p12`;

            logger.warn(
              { certId: input.id },
              'JKS format requested but returning PKCS#12. Use: keytool -importkeystore -srckeystore file.p12 -srcstoretype PKCS12 -destkeystore file.jks -deststoretype JKS'
            );
            break;
          }

          default:
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Unsupported format: ${input.format}`,
            });
        }

        // Create audit log entry
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.download',
          entityType: 'certificate',
          entityId: input.id,
          status: 'success',
          details: JSON.stringify({
            format: input.format,
            serialNumber: certificate.serialNumber,
            filename: filename,
          }),
          ipAddress: ctx.req.ip,
        });

        logger.info(
          { certId: input.id, format: input.format, filename },
          'Certificate downloaded successfully'
        );

        return {
          data,
          mimeType,
          filename,
          format: input.format,
        };
      } catch (error) {
        // Log failure to audit log
        await ctx.db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.download',
          entityType: 'certificate',
          entityId: input.id,
          status: 'failure',
          details: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            format: input.format,
          }),
          ipAddress: ctx.req.ip,
        });

        logger.error({ error, certId: input.id, format: input.format }, 'Failed to download certificate');

        // Re-throw if it's already a TRPCError
        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to generate certificate in ${input.format} format: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  bulkIssue: publicProcedure
    .input(bulkCreateCertificatesSchema)
    .output(
      z.object({
        successful: z.number(),
        failed: z.number(),
        results: z.array(
          z.object({
            row: z.number(),
            success: z.boolean(),
            certificateId: z.string().optional(),
            subject: z.string().optional(),
            serialNumber: z.string().optional(),
            error: z.string().optional(),
          })
        ),
      })
    )
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

      // Verify CA exists and is active
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

      // Parse CSV data
      const lines = input.csvData.trim().split('\n').filter(line => line.trim());
      const results: Array<{
        row: number;
        success: boolean;
        certificateId?: string;
        subject?: string;
        serialNumber?: string;
        error?: string;
      }> = [];

      let successful = 0;
      let failed = 0;

      // Helper function to detect SAN type
      const parseSAN = (sanString: string) => {
        const sans = sanString.split(';').map(s => s.trim()).filter(s => s);
        const sanDns: string[] = [];
        const sanIp: string[] = [];
        const sanEmail: string[] = [];

        for (const san of sans) {
          // Check if it's an email
          if (san.includes('@')) {
            sanEmail.push(san);
          }
          // Check if it's an IP address
          else if (/^(\d{1,3}\.){3}\d{1,3}$/.test(san)) {
            sanIp.push(san);
          }
          // Otherwise treat as DNS name
          else {
            sanDns.push(san);
          }
        }

        return { sanDns, sanIp, sanEmail };
      };

      // Process each CSV row
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const rowNumber = i + 1;

        try {
          // Parse CSV line (format: certificateType, CN, O, C, SANs, validityDays)
          const parts = line.split(',').map(p => p.trim());

          if (parts.length < 4) {
            throw new Error(`Invalid CSV format. Expected at least 4 fields (certificateType, CN, O, C), got ${parts.length}`);
          }

          const certificateType = parts[0];
          const commonName = parts[1];
          const organization = parts[2];
          const country = parts[3];
          const sanString = parts[4] || '';
          const validityDays = parts[5] ? parseInt(parts[5], 10) : input.defaultValidityDays || 365;

          // Validate certificate type
          if (!['server', 'client', 'code_signing', 'email'].includes(certificateType)) {
            throw new Error(`Invalid certificate type: ${certificateType}. Must be one of: server, client, code_signing, email`);
          }

          // Validate required fields
          if (!commonName) {
            throw new Error('Common Name (CN) is required');
          }
          if (!organization) {
            throw new Error('Organization (O) is required');
          }
          if (!country || country.length !== 2) {
            throw new Error('Country (C) must be a 2-letter code');
          }

          // Parse SANs
          const { sanDns, sanIp, sanEmail } = parseSAN(sanString);

          // Create subject DN
          const subjectDN = {
            CN: commonName,
            O: organization,
            C: country,
          };

          // Type-specific validation (simplified from issue procedure)
          switch (certificateType) {
            case 'server':
              const serverValidityCheck = validateCertificateValidity(validityDays, 825);
              if (!serverValidityCheck.valid) {
                throw new Error(serverValidityCheck.error || 'Invalid validity period');
              }

              const cnValidation = validateDomainName(commonName);
              if (!cnValidation.valid) {
                throw new Error(`Invalid common name: ${cnValidation.error}`);
              }

              const sansValidation = validateServerSANs(sanDns.length > 0 ? sanDns : undefined, sanIp.length > 0 ? sanIp : undefined);
              if (!sansValidation.valid) {
                throw new Error(`Invalid SANs: ${sansValidation.errors.join(', ')}`);
              }
              break;

            case 'client':
              const clientValidityCheck = validateCertificateValidity(validityDays, 730);
              if (!clientValidityCheck.valid) {
                throw new Error(clientValidityCheck.error || 'Invalid validity period');
              }

              const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(commonName);
              const isUsername = /^[a-zA-Z0-9._-]+$/.test(commonName);
              if (!isEmail && !isUsername) {
                throw new Error('Client certificate CN must be a valid email address or username');
              }
              break;

            case 'code_signing':
              const codeSignValidityCheck = validateCertificateValidity(validityDays, 1095);
              if (!codeSignValidityCheck.valid) {
                throw new Error(codeSignValidityCheck.error || 'Invalid validity period');
              }
              break;

            case 'email':
              if (sanEmail.length === 0) {
                throw new Error('Email protection certificates require at least one email address in SANs');
              }

              const emailValidityCheck = validateCertificateValidity(validityDays, 730);
              if (!emailValidityCheck.valid) {
                throw new Error(emailValidityCheck.error || 'Invalid validity period');
              }
              break;
          }

          // Generate certificate
          const certId = randomUUID();
          const kmsService = getKMSService();

          // Default to RSA-2048
          const keySizeInBits = 2048;

          // Generate key pair in KMS
          logger.info({ certId, certificateType, row: rowNumber }, 'Creating certificate key pair in KMS (bulk)');
          const keyPair = await kmsService.createKeyPair({
            sizeInBits: keySizeInBits,
            tags: [],
            purpose: 'certificate',
            entityId: certId,
          });

          // Sign certificate via KMS
          const subjectName = formatDN(subjectDN);
          logger.info({ certId, subjectName, caId: input.caId, row: rowNumber }, 'Signing certificate via KMS (bulk)');

          const certInfo = await kmsService.signCertificate({
            publicKeyId: keyPair.publicKeyId,
            issuerPrivateKeyId: caRecord.kmsKeyId,
            issuerCertificateId: caRecord.kmsCertificateId,
            issuerName: caRecord.subjectDn,
            subjectName: subjectName,
            daysValid: validityDays,
            tags: [],
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
            certificateType: certificateType as any,
            notBefore: certMetadata.validity.notBefore,
            notAfter: certMetadata.validity.notAfter,
            kmsCertificateId: certInfo.certificateId,
            kmsKeyId: keyPair.privateKeyId,
            status: 'active',
            sanDns: sanDns.length > 0 ? JSON.stringify(sanDns) : null,
            sanIp: sanIp.length > 0 ? JSON.stringify(sanIp) : null,
            sanEmail: sanEmail.length > 0 ? JSON.stringify(sanEmail) : null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Create audit log entry
          await ctx.db.insert(auditLog).values({
            id: randomUUID(),
            operation: 'certificate.bulkIssue',
            entityType: 'certificate',
            entityId: certId,
            status: 'success',
            details: JSON.stringify({
              caId: input.caId,
              certificateType: certificateType,
              subject: subjectName,
              keyAlgorithm: 'RSA-2048',
              validityDays: validityDays,
              serialNumber: certMetadata.serialNumber,
              kmsKeyId: keyPair.privateKeyId,
              sanDns: sanDns,
              sanIp: sanIp,
              sanEmail: sanEmail,
              bulkRow: rowNumber,
            }),
            ipAddress: ctx.req.ip,
          });

          logger.info({ certId, subjectName, caId: input.caId, row: rowNumber }, 'Certificate issued successfully (bulk)');

          results.push({
            row: rowNumber,
            success: true,
            certificateId: certId,
            subject: subjectName,
            serialNumber: certMetadata.serialNumber,
          });

          successful++;
        } catch (error) {
          logger.error({ error, row: rowNumber }, 'Failed to issue certificate in bulk');

          results.push({
            row: rowNumber,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });

          failed++;
        }
      }

      // Create overall audit log entry
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.bulkIssue',
        entityType: 'bulk_operation',
        entityId: input.caId,
        status: failed === 0 ? 'success' : 'partial',
        details: JSON.stringify({
          caId: input.caId,
          totalRows: lines.length,
          successful,
          failed,
          defaultValidityDays: input.defaultValidityDays,
        }),
        ipAddress: ctx.req.ip,
      });

      logger.info(
        { caId: input.caId, totalRows: lines.length, successful, failed },
        'Bulk certificate issuance completed'
      );

      return {
        successful,
        failed,
        results,
      };
    }),

  bulkRevoke: publicProcedure
    .input(bulkRevokeCertificatesSchema)
    .output(
      z.object({
        successful: z.number(),
        failed: z.number(),
        results: z.array(
          z.object({
            certificateId: z.string(),
            success: z.boolean(),
            error: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { TRPCError } = await import('@trpc/server');
      const { randomUUID } = await import('crypto');
      const { certificates, auditLog } = await import('../../db/schema.js');
      const { logger } = await import('../../lib/logger.js');
      const { eq } = await import('drizzle-orm');

      const results: Array<{
        certificateId: string;
        success: boolean;
        error?: string;
      }> = [];

      let successful = 0;
      let failed = 0;

      // Process each certificate
      for (const certId of input.certificateIds) {
        try {
          // Fetch certificate from database
          const certResult = await ctx.db
            .select()
            .from(certificates)
            .where(eq(certificates.id, certId))
            .limit(1);

          if (!certResult || certResult.length === 0) {
            throw new Error(`Certificate with ID ${certId} not found`);
          }

          const cert = certResult[0];

          // Validation: Cannot revoke already revoked certificate
          if (cert.status === 'revoked') {
            throw new Error('Certificate is already revoked');
          }

          const effectiveDate = new Date();

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
            .where(eq(certificates.id, certId));

          logger.info(
            { certId, reason: input.reason },
            'Certificate revoked successfully (bulk)'
          );

          // Create audit log entry
          await ctx.db.insert(auditLog).values({
            id: randomUUID(),
            operation: 'certificate.bulkRevoke',
            entityType: 'certificate',
            entityId: certId,
            status: 'success',
            details: JSON.stringify({
              caId: cert.caId,
              serialNumber: cert.serialNumber,
              reason: input.reason,
              details: input.details,
              generateCrl: input.generateCrl,
            }),
            ipAddress: ctx.req.ip,
          });

          results.push({
            certificateId: certId,
            success: true,
          });

          successful++;
        } catch (error) {
          logger.error({ error, certId }, 'Failed to revoke certificate in bulk');

          results.push({
            certificateId: certId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });

          failed++;
        }
      }

      // Create overall audit log entry
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.bulkRevoke',
        entityType: 'bulk_operation',
        entityId: 'bulk-revoke',
        status: failed === 0 ? 'success' : 'partial',
        details: JSON.stringify({
          totalCertificates: input.certificateIds.length,
          successful,
          failed,
          reason: input.reason,
          generateCrl: input.generateCrl,
        }),
        ipAddress: ctx.req.ip,
      });

      logger.info(
        { totalCertificates: input.certificateIds.length, successful, failed },
        'Bulk certificate revocation completed'
      );

      return {
        successful,
        failed,
        results,
      };
    }),

  bulkRenew: publicProcedure
    .input(bulkRenewCertificatesSchema)
    .output(
      z.object({
        successful: z.number(),
        failed: z.number(),
        results: z.array(
          z.object({
            originalCertificateId: z.string(),
            newCertificateId: z.string().optional(),
            success: z.boolean(),
            error: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { TRPCError } = await import('@trpc/server');
      const { randomUUID } = await import('crypto');
      const { certificateAuthorities, certificates, auditLog } = await import('../../db/schema.js');
      const { getKMSService } = await import('../../kms/service.js');
      const { formatDN } = await import('../../crypto/dn.js');
      const { parseCertificate } = await import('../../crypto/index.js');
      const { logger } = await import('../../lib/logger.js');
      const { eq } = await import('drizzle-orm');

      const results: Array<{
        originalCertificateId: string;
        newCertificateId?: string;
        success: boolean;
        error?: string;
      }> = [];

      let successful = 0;
      let failed = 0;

      const kmsService = getKMSService();

      // Process each certificate
      for (const certId of input.certificateIds) {
        const newCertId = randomUUID();

        try {
          // Fetch original certificate
          const originalCertResult = await ctx.db
            .select()
            .from(certificates)
            .where(eq(certificates.id, certId))
            .limit(1);

          if (!originalCertResult || originalCertResult.length === 0) {
            throw new Error(`Certificate with ID ${certId} not found`);
          }

          const originalCert = originalCertResult[0];

          // Validation: Cannot renew revoked certificates
          if (originalCert.status === 'revoked') {
            throw new Error('Cannot renew a revoked certificate');
          }

          // Validation: Key reuse only if original certificate is less than 90 days old
          if (!input.generateNewKey) {
            const certAgeMs = Date.now() - originalCert.createdAt.getTime();
            const certAgeDays = certAgeMs / (1000 * 60 * 60 * 24);
            if (certAgeDays >= 90) {
              throw new Error('Key reuse is only allowed for certificates less than 90 days old');
            }
          }

          // Retrieve CA from database
          const ca = await ctx.db
            .select()
            .from(certificateAuthorities)
            .where(eq(certificateAuthorities.id, originalCert.caId))
            .limit(1);

          if (!ca || ca.length === 0) {
            throw new Error(`CA with ID ${originalCert.caId} not found`);
          }

          const caRecord = ca[0];

          // Validate CA is active and not expired
          const now = new Date();
          if (caRecord.status !== 'active') {
            throw new Error(`CA is not active (status: ${caRecord.status})`);
          }

          if (now > caRecord.notAfter) {
            throw new Error('CA certificate has expired');
          }

          // Fetch original certificate from KMS
          const originalCertificatePem = await kmsService.getCertificate(
            originalCert.kmsCertificateId,
            originalCert.id
          );

          // Parse original certificate to extract metadata
          const originalParsed = parseCertificate(originalCertificatePem, 'PEM');

          const subjectDN = originalParsed.subject;

          // Determine SANs (copy from original)
          const sanDns = originalCert.sanDns ? JSON.parse(originalCert.sanDns) : null;
          const sanIp = originalCert.sanIp ? JSON.parse(originalCert.sanIp) : null;
          const sanEmail = originalCert.sanEmail ? JSON.parse(originalCert.sanEmail) : null;

          // Determine validity days
          const validityDays = input.validityDays ||
            Math.ceil((originalCert.notAfter.getTime() - originalCert.notBefore.getTime()) / (1000 * 60 * 60 * 24));

          let kmsKeyId: string;
          let publicKeyId: string;

          if (input.generateNewKey) {
            // Generate new key pair in KMS
            logger.info({ newCertId, originalCertId: certId }, 'Creating new key pair for certificate renewal (bulk)');

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
            logger.info({ newCertId, originalCertId: certId }, 'Reusing existing key pair for certificate renewal (bulk)');

            if (!originalCert.kmsKeyId) {
              throw new Error('Original certificate has no associated KMS key to reuse');
            }

            kmsKeyId = originalCert.kmsKeyId;
            publicKeyId = kmsKeyId.replace('-private', '-public');
          }

          const subjectName = formatDN(subjectDN);
          logger.info({ newCertId, subjectName, caId: originalCert.caId }, 'Signing renewed certificate via KMS (bulk)');

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
            kmsCertificateId: certInfo.certificateId,
            kmsKeyId: input.generateNewKey ? kmsKeyId : null,
            status: 'active',
            sanDns: sanDns ? JSON.stringify(sanDns) : null,
            sanIp: sanIp ? JSON.stringify(sanIp) : null,
            sanEmail: sanEmail ? JSON.stringify(sanEmail) : null,
            renewedFromId: certId,
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
              .where(eq(certificates.id, certId));

            logger.info({ originalCertId: certId }, 'Original certificate revoked (superseded by renewal) (bulk)');
          }

          // Create audit log entry for renewal
          await ctx.db.insert(auditLog).values({
            id: randomUUID(),
            operation: 'certificate.bulkRenew',
            entityType: 'certificate',
            entityId: newCertId,
            status: 'success',
            details: JSON.stringify({
              originalCertId: certId,
              caId: originalCert.caId,
              certificateType: originalCert.certificateType,
              subject: subjectName,
              validityDays: validityDays,
              serialNumber: certMetadata.serialNumber,
              kmsKeyId: kmsKeyId,
              generateNewKey: input.generateNewKey,
              revokeOriginal: input.revokeOriginal,
            }),
            ipAddress: ctx.req.ip,
          });

          logger.info({ newCertId, originalCertId: certId }, 'Certificate renewed successfully (bulk)');

          results.push({
            originalCertificateId: certId,
            newCertificateId: newCertId,
            success: true,
          });

          successful++;
        } catch (error) {
          logger.error({ error, newCertId, originalCertId: certId }, 'Failed to renew certificate in bulk');

          results.push({
            originalCertificateId: certId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });

          failed++;
        }
      }

      // Create overall audit log entry
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.bulkRenew',
        entityType: 'bulk_operation',
        entityId: 'bulk-renew',
        status: failed === 0 ? 'success' : 'partial',
        details: JSON.stringify({
          totalCertificates: input.certificateIds.length,
          successful,
          failed,
          generateNewKey: input.generateNewKey,
          revokeOriginal: input.revokeOriginal,
        }),
        ipAddress: ctx.req.ip,
      });

      logger.info(
        { totalCertificates: input.certificateIds.length, successful, failed },
        'Bulk certificate renewal completed'
      );

      return {
        successful,
        failed,
        results,
      };
    }),

  bulkDelete: publicProcedure
    .input(bulkDeleteCertificatesSchema)
    .output(
      z.object({
        successful: z.number(),
        failed: z.number(),
        results: z.array(
          z.object({
            certificateId: z.string(),
            success: z.boolean(),
            error: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { TRPCError } = await import('@trpc/server');
      const { randomUUID } = await import('crypto');
      const { certificates, auditLog } = await import('../../db/schema.js');
      const { getKMSService } = await import('../../kms/service.js');
      const { logger } = await import('../../lib/logger.js');
      const { eq } = await import('drizzle-orm');

      const results: Array<{
        certificateId: string;
        success: boolean;
        error?: string;
      }> = [];

      let successful = 0;
      let failed = 0;

      // Process each certificate
      for (const certId of input.certificateIds) {
        try {
          // Fetch certificate from database
          const certResult = await ctx.db
            .select()
            .from(certificates)
            .where(eq(certificates.id, certId))
            .limit(1);

          if (!certResult || certResult.length === 0) {
            throw new Error(`Certificate with ID ${certId} not found`);
          }

          const cert = certResult[0];

          // Validation: Certificate must be revoked or expired > 90 days
          const now = new Date();
          const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

          const isRevoked = cert.status === 'revoked';
          const isExpiredOverNinetyDays = cert.notAfter < ninetyDaysAgo;

          if (!isRevoked && !isExpiredOverNinetyDays) {
            throw new Error('Certificate must be revoked or expired for more than 90 days before deletion');
          }

          // Create audit log entry BEFORE deletion
          await ctx.db.insert(auditLog).values({
            id: randomUUID(),
            operation: 'certificate.bulkDelete',
            entityType: 'certificate',
            entityId: certId,
            status: 'success',
            details: JSON.stringify({
              caId: cert.caId,
              serialNumber: cert.serialNumber,
              certificateType: cert.certificateType,
              status: cert.status,
              destroyKey: input.destroyKey,
              removeFromCrl: input.removeFromCrl,
            }),
            ipAddress: ctx.req.ip,
          });

          // Optional: Destroy KMS key if requested
          if (input.destroyKey && cert.kmsKeyId) {
            try {
              const kmsService = getKMSService();
              await kmsService.destroyKey(cert.kmsKeyId);
              logger.info(
                { certId, kmsKeyId: cert.kmsKeyId },
                'KMS key destroyed for deleted certificate (bulk)'
              );
            } catch (error) {
              logger.warn(
                { error, certId, kmsKeyId: cert.kmsKeyId },
                'Failed to destroy KMS key, continuing with certificate deletion (bulk)'
              );
            }
          }

          // Delete certificate from database
          await ctx.db
            .delete(certificates)
            .where(eq(certificates.id, certId));

          logger.info(
            { certId, serialNumber: cert.serialNumber },
            'Certificate deleted successfully (bulk)'
          );

          results.push({
            certificateId: certId,
            success: true,
          });

          successful++;
        } catch (error) {
          logger.error({ error, certId }, 'Failed to delete certificate in bulk');

          results.push({
            certificateId: certId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });

          failed++;
        }
      }

      // Create overall audit log entry
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.bulkDelete',
        entityType: 'bulk_operation',
        entityId: 'bulk-delete',
        status: failed === 0 ? 'success' : 'partial',
        details: JSON.stringify({
          totalCertificates: input.certificateIds.length,
          successful,
          failed,
          destroyKey: input.destroyKey,
        }),
        ipAddress: ctx.req.ip,
      });

      logger.info(
        { totalCertificates: input.certificateIds.length, successful, failed },
        'Bulk certificate deletion completed'
      );

      return {
        successful,
        failed,
        results,
      };
    }),

  bulkDownload: publicProcedure
    .input(bulkDownloadCertificatesSchema)
    .output(
      z.object({
        data: z.string(),
        filename: z.string(),
        mimeType: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { TRPCError } = await import('@trpc/server');
      const { randomUUID } = await import('crypto');
      const { certificates, certificateAuthorities, auditLog } = await import('../../db/schema.js');
      const { getKMSService } = await import('../../kms/service.js');
      const { logger } = await import('../../lib/logger.js');
      const { eq, inArray } = await import('drizzle-orm');
      const JSZip = await import('jszip');
      const forge = await import('node-forge');

      // Fetch all certificates
      const certResults = await ctx.db
        .select({
          certificate: certificates,
          ca: certificateAuthorities,
        })
        .from(certificates)
        .leftJoin(certificateAuthorities, eq(certificates.caId, certificateAuthorities.id))
        .where(inArray(certificates.id, input.certificateIds));

      if (certResults.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No certificates found',
        });
      }

      const kmsService = getKMSService();
      const zip = new JSZip.default();

      // Process each certificate
      for (const { certificate, ca } of certResults) {
        if (!ca) {
          logger.warn({ certId: certificate.id }, 'Certificate has no associated CA, skipping');
          continue;
        }

        try {
          // Fetch certificate from KMS
          const certificatePem = await kmsService.getCertificate(
            certificate.kmsCertificateId,
            certificate.id
          );

          // Extract CN for filename
          const cnMatch = certificate.subjectDn.match(/CN=([^,]+)/);
          const commonName = cnMatch ? cnMatch[1].replace(/[^a-zA-Z0-9-_.]/g, '_') : 'certificate';
          const serialShort = certificate.serialNumber.substring(0, 8);

          let fileContent: string;
          let fileExtension: string;

          switch (input.format) {
            case 'pem':
              fileContent = certificatePem;
              fileExtension = 'pem';
              break;

            case 'der':
              const forgeCert = forge.default.pki.certificateFromPem(certificatePem);
              const derBytes = forge.default.asn1.toDer(
                forge.default.pki.certificateToAsn1(forgeCert)
              ).getBytes();
              fileContent = Buffer.from(derBytes, 'binary').toString('base64');
              fileExtension = 'der';
              break;

            case 'pem-chain':
              const caCertificatePem = await kmsService.getCertificate(
                ca.kmsCertificateId,
                ca.id
              );
              fileContent = certificatePem + '\n' + caCertificatePem;
              fileExtension = 'pem';
              break;

            default:
              logger.warn({ format: input.format }, 'Unsupported format, defaulting to PEM');
              fileContent = certificatePem;
              fileExtension = 'pem';
          }

          // Add to ZIP
          const filename = `${commonName}-${serialShort}.${fileExtension}`;
          zip.file(filename, fileContent);

          logger.info({ certId: certificate.id, filename }, 'Certificate added to ZIP (bulk download)');
        } catch (error) {
          logger.error({ error, certId: certificate.id }, 'Failed to process certificate for bulk download');
        }
      }

      // Generate ZIP file
      const zipData = await zip.generateAsync({ type: 'base64' });

      // Create audit log entry
      await ctx.db.insert(auditLog).values({
        id: randomUUID(),
        operation: 'certificate.bulkDownload',
        entityType: 'bulk_operation',
        entityId: 'bulk-download',
        status: 'success',
        details: JSON.stringify({
          totalCertificates: input.certificateIds.length,
          format: input.format,
        }),
        ipAddress: ctx.req.ip,
      });

      logger.info(
        { totalCertificates: input.certificateIds.length, format: input.format },
        'Bulk certificate download completed'
      );

      return {
        data: zipData,
        filename: `certificates-${new Date().toISOString().split('T')[0]}.zip`,
        mimeType: 'application/zip',
      };
    }),
});
