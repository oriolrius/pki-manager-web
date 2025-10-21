import { router, publicProcedure } from '../init.js';
import {
  listCertificatesSchema,
  getCertificateSchema,
  createCertificateSchema,
  renewCertificateSchema,
  revokeCertificateSchema,
  deleteCertificateSchema,
} from '../schemas.js';

export const certificateRouter = router({
  list: publicProcedure
    .input(listCertificatesSchema)
    .query(async ({ ctx, input }) => {
      // TODO: Implement in task-013 (Certificate listing)
      return [];
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
