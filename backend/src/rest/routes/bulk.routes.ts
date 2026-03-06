import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import forge from 'node-forge';
import JSZip from 'jszip';
import { db } from '../../db/client.js';
import { certificates, certificateAuthorities, auditLog } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import { formatDN } from '../../crypto/dn.js';
import { parseCertificate } from '../../crypto/index.js';
import {
  validateDomainName,
  validateServerSANs,
  validateCertificateValidity,
} from '../../crypto/validation.js';
import { logger } from '../../lib/logger.js';
import {
  generateJKSKeystore,
  generateJKSTruststore,
  JKSKeytoolError,
} from '../../services/jks.service.js';
import { buildCertificateExtensions } from '../../services/certificate.service.js';

// Request/Response types
interface BulkIssueBody {
  caId: string;
  csvData: string;
  defaultValidityDays?: number;
}

interface BulkRevokeBody {
  certificateIds: string[];
  reason: string;
  details?: string;
  generateCrl?: boolean;
}

interface BulkRenewBody {
  certificateIds: string[];
  generateNewKey?: boolean;
  validityDays?: number;
  revokeOriginal?: boolean;
}

interface BulkDeleteBody {
  certificateIds: string[];
  destroyKey?: boolean;
  removeFromCrl?: boolean;
}

interface BulkDownloadBody {
  certificateIds: string[];
  format?: string;
  password?: string;
  encryptPrivateKey?: boolean;
}

// Inline error response schemas
const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
} as const;


// Error response helper
function sendError(
  reply: FastifyReply,
  code: number,
  errorCode: string,
  message: string,
  details?: Array<{ field: string; message: string }>
) {
  reply.code(code);
  return {
    error: {
      code: errorCode,
      message,
      ...(details && { details }),
    },
  };
}

// Revocation reason enum values
const REVOCATION_REASONS = [
  'unspecified',
  'keyCompromise',
  'caCompromise',
  'affiliationChanged',
  'superseded',
  'cessationOfOperation',
  'certificateHold',
  'privilegeWithdrawn',
] as const;

// Download format enum values
const DOWNLOAD_FORMATS = [
  'pem',
  'crt',
  'der',
  'cer',
  'pem-chain',
  'pem-key',
  'pkcs7',
  'p7b',
  'pkcs12',
  'pfx',
  'p12',
  'jks-keystore',
  'jks-truststore',
  'docker-volume',
  'all',
] as const;

// Certificate type enum values
const CERTIFICATE_TYPES = ['server', 'client', 'dual', 'code_signing', 'email'] as const;

/**
 * Bulk Operations REST routes
 *
 * Endpoints:
 * - POST /bulk/issue - Bulk issue certificates from CSV
 * - POST /bulk/revoke - Bulk revoke certificates
 * - POST /bulk/renew - Bulk renew certificates
 * - DELETE /bulk - Bulk delete certificates
 * - POST /bulk/download - Bulk download certificates
 */
export async function bulkRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /bulk/issue - Bulk issue certificates from CSV
  fastify.post<{ Body: BulkIssueBody }>('/issue', {
    schema: {
      description: 'Bulk issue certificates from CSV data',
      tags: ['Bulk Operations'],
      body: {
        type: 'object',
        required: ['caId', 'csvData'],
        properties: {
          caId: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the issuing CA',
          },
          csvData: {
            type: 'string',
            minLength: 1,
            description: 'CSV data with certificate details (certificateType,CN,O,C,SANs,validityDays)',
          },
          defaultValidityDays: {
            type: 'integer',
            minimum: 1,
            maximum: 825,
            description: 'Default validity period in days if not specified per row',
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            successful: { type: 'integer' },
            failed: { type: 'integer' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  row: { type: 'integer' },
                  success: { type: 'boolean' },
                  certificateId: { type: 'string', format: 'uuid' },
                  subject: { type: 'string' },
                  serialNumber: { type: 'string' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
        400: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { caId, csvData, defaultValidityDays } = request.body;

    // Verify CA exists and is active
    const caResult = await db
      .select()
      .from(certificateAuthorities)
      .where(eq(certificateAuthorities.id, caId))
      .limit(1);

    if (!caResult || caResult.length === 0) {
      return sendError(reply, 404, 'CA_NOT_FOUND', `CA with ID ${caId} not found`);
    }

    const caRecord = caResult[0];

    // Validate CA is active and not expired
    const now = new Date();
    if (caRecord.status !== 'active') {
      return sendError(reply, 409, 'CA_NOT_ACTIVE', `CA is not active (status: ${caRecord.status})`);
    }

    if (now > caRecord.notAfter) {
      return sendError(reply, 409, 'CA_EXPIRED', 'CA certificate has expired');
    }

    // Parse CSV data
    const lines = csvData.trim().split('\n').filter(line => line.trim());
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
        if (san.includes('@')) {
          sanEmail.push(san);
        } else if (/^(\d{1,3}\.){3}\d{1,3}$/.test(san)) {
          sanIp.push(san);
        } else {
          sanDns.push(san);
        }
      }

      return { sanDns, sanIp, sanEmail };
    };

    const kmsService = getKMSService();

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
        const validityDays = parts[5] ? parseInt(parts[5], 10) : defaultValidityDays || 365;

        // Validate certificate type
        if (!CERTIFICATE_TYPES.includes(certificateType as typeof CERTIFICATE_TYPES[number])) {
          throw new Error(`Invalid certificate type: ${certificateType}. Must be one of: ${CERTIFICATE_TYPES.join(', ')}`);
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

        // Type-specific validation
        switch (certificateType) {
          case 'server': {
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
          }

          case 'client': {
            const clientValidityCheck = validateCertificateValidity(validityDays, 730);
            if (!clientValidityCheck.valid) {
              throw new Error(clientValidityCheck.error || 'Invalid validity period');
            }

            const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(commonName);
            const isUsername = /^[a-zA-Z0-9._-]+$/.test(commonName);
            const isHostname = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(commonName);
            if (!isEmail && !isUsername && !isHostname) {
              throw new Error('Client certificate CN must be a valid email address, username, or hostname');
            }
            break;
          }

          case 'dual': {
            // Dual certificates use server validation rules
            const dualValidityCheck = validateCertificateValidity(validityDays, 825);
            if (!dualValidityCheck.valid) {
              throw new Error(dualValidityCheck.error || 'Invalid validity period');
            }

            const dualCnValidation = validateDomainName(commonName);
            if (!dualCnValidation.valid) {
              throw new Error(`Invalid common name: ${dualCnValidation.error}`);
            }

            const dualSansValidation = validateServerSANs(
              sanDns.length > 0 ? sanDns : undefined,
              sanIp.length > 0 ? sanIp : undefined
            );
            if (!dualSansValidation.valid) {
              throw new Error(`Invalid SANs: ${dualSansValidation.errors.join(', ')}`);
            }
            break;
          }

          case 'code_signing': {
            const codeSignValidityCheck = validateCertificateValidity(validityDays, 1095);
            if (!codeSignValidityCheck.valid) {
              throw new Error(codeSignValidityCheck.error || 'Invalid validity period');
            }
            break;
          }

          case 'email': {
            if (sanEmail.length === 0) {
              throw new Error('Email protection certificates require at least one email address in SANs');
            }

            const emailValidityCheck = validateCertificateValidity(validityDays, 730);
            if (!emailValidityCheck.valid) {
              throw new Error(emailValidityCheck.error || 'Invalid validity period');
            }
            break;
          }
        }

        // Generate certificate
        const certId = randomUUID();

        // Generate key pair in KMS
        logger.info({ certId, certificateType, row: rowNumber }, 'Creating certificate key pair in KMS (bulk REST)');
        const keyPair = await kmsService.createKeyPair({
          sizeInBits: 2048,
          tags: [],
          purpose: 'certificate',
          entityId: certId,
        });

        // Sign certificate via KMS
        const subjectName = formatDN(subjectDN);
        logger.info({ certId, subjectName, caId, row: rowNumber }, 'Signing certificate via KMS (bulk REST)');

        // Build X.509 v3 extensions including SANs
        const x509Extensions = buildCertificateExtensions({
          certificateType: certificateType as 'server' | 'client' | 'dual' | 'code_signing' | 'email',
          sanDns: sanDns.length > 0 ? sanDns : undefined,
          sanIp: sanIp.length > 0 ? sanIp : undefined,
          sanEmail: sanEmail.length > 0 ? sanEmail : undefined,
        });

        const certInfo = await kmsService.signCertificate({
          publicKeyId: keyPair.publicKeyId,
          issuerPrivateKeyId: caRecord.kmsKeyId,
          issuerCertificateId: caRecord.kmsCertificateId,
          issuerName: caRecord.subjectDn,
          subjectName: subjectName,
          daysValid: validityDays,
          tags: [],
          entityId: certId,
          x509Extensions,
        });

        // Convert certificate data from hex to PEM
        const certDataHex = certInfo.certificateData;
        const certDataBuffer = Buffer.from(certDataHex, 'hex');
        const certBase64 = certDataBuffer.toString('base64');
        const certificatePem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;

        // Parse certificate to extract metadata
        const certMetadata = parseCertificate(certificatePem, 'PEM');

        // Store certificate in database
        await db.insert(certificates).values({
          id: certId,
          caId: caId,
          subjectDn: subjectName,
          serialNumber: certMetadata.serialNumber,
          certificateType: certificateType as 'server' | 'client' | 'dual' | 'code_signing' | 'email',
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
        await db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.bulkIssue',
          entityType: 'certificate',
          entityId: certId,
          status: 'success',
          details: JSON.stringify({
            caId: caId,
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
          ipAddress: request.ip,
        } as any);

        logger.info({ certId, subjectName, caId, row: rowNumber }, 'Certificate issued successfully (bulk REST)');

        results.push({
          row: rowNumber,
          success: true,
          certificateId: certId,
          subject: subjectName,
          serialNumber: certMetadata.serialNumber,
        });

        successful++;
      } catch (error) {
        logger.error({ error, row: rowNumber }, 'Failed to issue certificate in bulk REST');

        results.push({
          row: rowNumber,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        failed++;
      }
    }

    // Create overall audit log entry
    await db.insert(auditLog).values({
      id: randomUUID(),
      operation: 'certificate.bulkIssue',
      entityType: 'bulk_operation',
      entityId: caId,
      status: failed === 0 ? 'success' : 'partial',
      details: JSON.stringify({
        caId: caId,
        totalRows: lines.length,
        successful,
        failed,
        defaultValidityDays: defaultValidityDays,
      }),
      ipAddress: request.ip,
    } as any);

    logger.info(
      { caId, totalRows: lines.length, successful, failed },
      'Bulk certificate issuance completed (REST)'
    );

    reply.code(201);
    return {
      successful,
      failed,
      results,
    };
  });

  // POST /bulk/revoke - Bulk revoke certificates
  fastify.post<{ Body: BulkRevokeBody }>('/revoke', {
    schema: {
      description: 'Bulk revoke certificates',
      tags: ['Bulk Operations'],
      body: {
        type: 'object',
        required: ['certificateIds', 'reason'],
        properties: {
          certificateIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            maxItems: 100,
            description: 'Array of certificate IDs to revoke',
          },
          reason: {
            type: 'string',
            enum: [...REVOCATION_REASONS],
            description: 'Revocation reason',
          },
          details: {
            type: 'string',
            maxLength: 500,
            description: 'Additional details about the revocation',
          },
          generateCrl: {
            type: 'boolean',
            default: true,
            description: 'Generate a new CRL after revocation',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            successful: { type: 'integer' },
            failed: { type: 'integer' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  certificateId: { type: 'string', format: 'uuid' },
                  success: { type: 'boolean' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
        400: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, _reply) => {
    const { certificateIds, reason, details, generateCrl } = request.body;

    const results: Array<{
      certificateId: string;
      success: boolean;
      error?: string;
    }> = [];

    let successful = 0;
    let failed = 0;

    // Process each certificate
    for (const certId of certificateIds) {
      try {
        // Fetch certificate from database
        const certResult = await db
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
        await db
          .update(certificates)
          .set({
            status: 'revoked',
            revocationDate: effectiveDate,
            revocationReason: details ? `${reason}: ${details}` : reason,
            updatedAt: new Date(),
          })
          .where(eq(certificates.id, certId));

        logger.info(
          { certId, reason },
          'Certificate revoked successfully (bulk REST)'
        );

        // Create audit log entry
        await db.insert(auditLog).values({
          id: randomUUID(),
          operation: 'certificate.bulkRevoke',
          entityType: 'certificate',
          entityId: certId,
          status: 'success',
          details: JSON.stringify({
            caId: cert.caId,
            serialNumber: cert.serialNumber,
            reason: reason,
            details: details,
            generateCrl: generateCrl,
          }),
          ipAddress: request.ip,
        } as any);

        results.push({
          certificateId: certId,
          success: true,
        });

        successful++;
      } catch (error) {
        logger.error({ error, certId }, 'Failed to revoke certificate in bulk REST');

        results.push({
          certificateId: certId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        failed++;
      }
    }

    // Create overall audit log entry
    await db.insert(auditLog).values({
      id: randomUUID(),
      operation: 'certificate.bulkRevoke',
      entityType: 'bulk_operation',
      entityId: 'bulk-revoke',
      status: failed === 0 ? 'success' : 'partial',
      details: JSON.stringify({
        totalCertificates: certificateIds.length,
        successful,
        failed,
        reason: reason,
        generateCrl: generateCrl,
      }),
      ipAddress: request.ip,
    } as any);

    logger.info(
      { totalCertificates: certificateIds.length, successful, failed },
      'Bulk certificate revocation completed (REST)'
    );

    return {
      successful,
      failed,
      results,
    };
  });

  // POST /bulk/renew - Bulk renew certificates
  fastify.post<{ Body: BulkRenewBody }>('/renew', {
    schema: {
      description: 'Bulk renew certificates',
      tags: ['Bulk Operations'],
      body: {
        type: 'object',
        required: ['certificateIds'],
        properties: {
          certificateIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            maxItems: 100,
            description: 'Array of certificate IDs to renew',
          },
          generateNewKey: {
            type: 'boolean',
            default: true,
            description: 'Generate a new key pair for the renewed certificate',
          },
          validityDays: {
            type: 'integer',
            minimum: 1,
            maximum: 825,
            description: 'Validity period in days (defaults to original validity)',
          },
          revokeOriginal: {
            type: 'boolean',
            default: false,
            description: 'Revoke the original certificate after renewal',
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            successful: { type: 'integer' },
            failed: { type: 'integer' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  originalCertificateId: { type: 'string', format: 'uuid' },
                  newCertificateId: { type: 'string', format: 'uuid' },
                  success: { type: 'boolean' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
        400: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { certificateIds, generateNewKey = true, validityDays, revokeOriginal = false } = request.body;

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
    for (const certId of certificateIds) {
      const newCertId = randomUUID();

      try {
        // Fetch original certificate
        const originalCertResult = await db
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
        if (!generateNewKey) {
          const certAgeMs = Date.now() - originalCert.createdAt.getTime();
          const certAgeDays = certAgeMs / (1000 * 60 * 60 * 24);
          if (certAgeDays >= 90) {
            throw new Error('Key reuse is only allowed for certificates less than 90 days old');
          }
        }

        // Retrieve CA from database
        const caResult = await db
          .select()
          .from(certificateAuthorities)
          .where(eq(certificateAuthorities.id, originalCert.caId))
          .limit(1);

        if (!caResult || caResult.length === 0) {
          throw new Error(`CA with ID ${originalCert.caId} not found`);
        }

        const caRecord = caResult[0];

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
        const effectiveValidityDays = validityDays ||
          Math.ceil((originalCert.notAfter.getTime() - originalCert.notBefore.getTime()) / (1000 * 60 * 60 * 24));

        let kmsKeyId: string;
        let publicKeyId: string;

        if (generateNewKey) {
          // Generate new key pair in KMS
          logger.info({ newCertId, originalCertId: certId }, 'Creating new key pair for certificate renewal (bulk REST)');

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
          logger.info({ newCertId, originalCertId: certId }, 'Reusing existing key pair for certificate renewal (bulk REST)');

          if (!originalCert.kmsKeyId) {
            throw new Error('Original certificate has no associated KMS key to reuse');
          }

          kmsKeyId = originalCert.kmsKeyId;
          publicKeyId = kmsKeyId.replace('-private', '-public');
        }

        const subjectName = formatDN(subjectDN);
        logger.info({ newCertId, subjectName, caId: originalCert.caId }, 'Signing renewed certificate via KMS (bulk REST)');

        // Build X.509 v3 extensions including SANs
        const x509Extensions = buildCertificateExtensions({
          certificateType: originalCert.certificateType as 'server' | 'client' | 'dual' | 'code_signing' | 'email',
          sanDns: sanDns || undefined,
          sanIp: sanIp || undefined,
          sanEmail: sanEmail || undefined,
        });

        const certInfo = await kmsService.signCertificate({
          publicKeyId: publicKeyId,
          issuerPrivateKeyId: caRecord.kmsKeyId,
          issuerCertificateId: caRecord.kmsCertificateId,
          issuerName: caRecord.subjectDn,
          subjectName: subjectName,
          daysValid: effectiveValidityDays,
          tags: [],
          entityId: newCertId,
          x509Extensions,
        });

        // Convert certificate data from hex to PEM
        const certDataHex = certInfo.certificateData;
        const certDataBuffer = Buffer.from(certDataHex, 'hex');
        const certBase64 = certDataBuffer.toString('base64');
        const certificatePem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;

        // Parse new certificate to extract metadata
        const certMetadata = parseCertificate(certificatePem, 'PEM');

        // Store new certificate in database with renewal chain link
        await db.insert(certificates).values({
          id: newCertId,
          caId: originalCert.caId,
          subjectDn: subjectName,
          serialNumber: certMetadata.serialNumber,
          certificateType: originalCert.certificateType,
          notBefore: certMetadata.validity.notBefore,
          notAfter: certMetadata.validity.notAfter,
          kmsCertificateId: certInfo.certificateId,
          kmsKeyId: generateNewKey ? kmsKeyId : null,
          status: 'active',
          sanDns: sanDns ? JSON.stringify(sanDns) : null,
          sanIp: sanIp ? JSON.stringify(sanIp) : null,
          sanEmail: sanEmail ? JSON.stringify(sanEmail) : null,
          renewedFromId: certId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Optionally revoke the original certificate
        if (revokeOriginal) {
          await db
            .update(certificates)
            .set({
              status: 'revoked',
              revocationDate: new Date(),
              revocationReason: 'superseded',
              updatedAt: new Date(),
            })
            .where(eq(certificates.id, certId));

          logger.info({ originalCertId: certId }, 'Original certificate revoked (superseded by renewal) (bulk REST)');
        }

        // Create audit log entry for renewal
        await db.insert(auditLog).values({
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
            validityDays: effectiveValidityDays,
            serialNumber: certMetadata.serialNumber,
            kmsKeyId: kmsKeyId,
            generateNewKey: generateNewKey,
            revokeOriginal: revokeOriginal,
          }),
          ipAddress: request.ip,
        } as any);

        logger.info({ newCertId, originalCertId: certId }, 'Certificate renewed successfully (bulk REST)');

        results.push({
          originalCertificateId: certId,
          newCertificateId: newCertId,
          success: true,
        });

        successful++;
      } catch (error) {
        logger.error({ error, newCertId, originalCertId: certId }, 'Failed to renew certificate in bulk REST');

        results.push({
          originalCertificateId: certId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        failed++;
      }
    }

    // Create overall audit log entry
    await db.insert(auditLog).values({
      id: randomUUID(),
      operation: 'certificate.bulkRenew',
      entityType: 'bulk_operation',
      entityId: 'bulk-renew',
      status: failed === 0 ? 'success' : 'partial',
      details: JSON.stringify({
        totalCertificates: certificateIds.length,
        successful,
        failed,
        generateNewKey: generateNewKey,
        revokeOriginal: revokeOriginal,
      }),
      ipAddress: request.ip,
    } as any);

    logger.info(
      { totalCertificates: certificateIds.length, successful, failed },
      'Bulk certificate renewal completed (REST)'
    );

    reply.code(201);
    return {
      successful,
      failed,
      results,
    };
  });

  // DELETE /bulk - Bulk delete certificates
  fastify.delete<{ Body: BulkDeleteBody }>('/', {
    schema: {
      description: 'Bulk delete certificates (must be revoked or expired > 90 days)',
      tags: ['Bulk Operations'],
      body: {
        type: 'object',
        required: ['certificateIds'],
        properties: {
          certificateIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            maxItems: 100,
            description: 'Array of certificate IDs to delete',
          },
          destroyKey: {
            type: 'boolean',
            default: true,
            description: 'Also destroy the private key in KMS',
          },
          removeFromCrl: {
            type: 'boolean',
            default: false,
            description: 'Remove from CRL (not recommended)',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            successful: { type: 'integer' },
            failed: { type: 'integer' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  certificateId: { type: 'string', format: 'uuid' },
                  success: { type: 'boolean' },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
        400: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, _reply) => {
    const { certificateIds, destroyKey = true, removeFromCrl = false } = request.body;

    const results: Array<{
      certificateId: string;
      success: boolean;
      error?: string;
    }> = [];

    let successful = 0;
    let failed = 0;

    const kmsService = getKMSService();

    // Process each certificate
    for (const certId of certificateIds) {
      try {
        // Fetch certificate from database
        const certResult = await db
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
        await db.insert(auditLog).values({
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
            destroyKey: destroyKey,
            removeFromCrl: removeFromCrl,
          }),
          ipAddress: request.ip,
        } as any);

        // Optional: Destroy KMS key if requested
        if (destroyKey && cert.kmsKeyId) {
          try {
            await kmsService.destroyKey(cert.kmsKeyId);
            logger.info(
              { certId, kmsKeyId: cert.kmsKeyId },
              'KMS key destroyed for deleted certificate (bulk REST)'
            );
          } catch (error) {
            logger.warn(
              { error, certId, kmsKeyId: cert.kmsKeyId },
              'Failed to destroy KMS key, continuing with certificate deletion (bulk REST)'
            );
          }
        }

        // Delete certificate from database
        await db
          .delete(certificates)
          .where(eq(certificates.id, certId));

        logger.info(
          { certId, serialNumber: cert.serialNumber },
          'Certificate deleted successfully (bulk REST)'
        );

        results.push({
          certificateId: certId,
          success: true,
        });

        successful++;
      } catch (error) {
        logger.error({ error, certId }, 'Failed to delete certificate in bulk REST');

        results.push({
          certificateId: certId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        failed++;
      }
    }

    // Create overall audit log entry
    await db.insert(auditLog).values({
      id: randomUUID(),
      operation: 'certificate.bulkDelete',
      entityType: 'bulk_operation',
      entityId: 'bulk-delete',
      status: failed === 0 ? 'success' : 'partial',
      details: JSON.stringify({
        totalCertificates: certificateIds.length,
        successful,
        failed,
        destroyKey: destroyKey,
      }),
      ipAddress: request.ip,
    } as any);

    logger.info(
      { totalCertificates: certificateIds.length, successful, failed },
      'Bulk certificate deletion completed (REST)'
    );

    return {
      successful,
      failed,
      results,
    };
  });

  // POST /bulk/download - Bulk download certificates
  fastify.post<{ Body: BulkDownloadBody }>('/download', {
    schema: {
      description: 'Bulk download certificates in various formats as a ZIP file',
      tags: ['Bulk Operations'],
      body: {
        type: 'object',
        required: ['certificateIds'],
        properties: {
          certificateIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            maxItems: 100,
            description: 'Array of certificate IDs to download',
          },
          format: {
            type: 'string',
            enum: [...DOWNLOAD_FORMATS],
            default: 'pem',
            description: 'Download format',
          },
          password: {
            type: 'string',
            minLength: 8,
            description: 'Password for encrypted formats',
          },
          encryptPrivateKey: {
            type: 'boolean',
            default: true,
            description: 'Whether to encrypt private key with password',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'string', description: 'Base64-encoded ZIP file' },
            filename: { type: 'string' },
            mimeType: { type: 'string' },
          },
        },
        400: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { certificateIds, format = 'pem', password, encryptPrivateKey = true } = request.body;

    // Validate password requirement for encrypted formats
    const keyFormats = ['pem-key', 'pkcs12', 'pfx', 'p12', 'jks-keystore', 'docker-volume', 'all'];
    if (keyFormats.includes(format) && encryptPrivateKey && !password) {
      return sendError(reply, 400, 'PASSWORD_REQUIRED', `Password is required when private key encryption is enabled for ${format.toUpperCase()} format`);
    }

    // JKS truststore always requires a password
    if (format === 'jks-truststore' && !password) {
      return sendError(reply, 400, 'PASSWORD_REQUIRED', 'Password is required for JKS truststore format');
    }

    // Fetch all certificates with their CAs
    const certResults = await db
      .select({
        certificate: certificates,
        ca: certificateAuthorities,
      })
      .from(certificates)
      .leftJoin(certificateAuthorities, eq(certificates.caId, certificateAuthorities.id))
      .where(inArray(certificates.id, certificateIds));

    if (certResults.length === 0) {
      return sendError(reply, 404, 'NOT_FOUND', 'No certificates found');
    }

    const kmsService = getKMSService();
    const zip = new JSZip();

    // Helper function to generate certificate file content
    const generateCertificateFile = async (
      certificate: typeof certResults[0]['certificate'],
      ca: typeof certResults[0]['ca'],
      targetFormat: string
    ): Promise<{ content: string | Buffer; extension: string; isBinary?: boolean }> => {
      const certificatePem = await kmsService.getCertificate(
        certificate.kmsCertificateId,
        certificate.id
      );

      if (!ca) {
        throw new Error('CA not found for certificate');
      }

      const caCertificatePem = await kmsService.getCertificate(
        ca.kmsCertificateId,
        ca.id
      );

      const forgeCert = forge.pki.certificateFromPem(certificatePem);
      const forgeCaCert = forge.pki.certificateFromPem(caCertificatePem);

      switch (targetFormat) {
        case 'pem':
        case 'crt':
          return { content: certificatePem, extension: targetFormat };

        case 'der':
        case 'cer': {
          const derBytes = forge.asn1.toDer(
            forge.pki.certificateToAsn1(forgeCert)
          ).getBytes();
          return {
            content: Buffer.from(derBytes, 'binary'),
            extension: targetFormat,
            isBinary: true,
          };
        }

        case 'pem-chain':
          return { content: certificatePem + '\n' + caCertificatePem, extension: 'pem' };

        case 'pem-key': {
          if (!certificate.kmsKeyId) {
            throw new Error(`Certificate ${certificate.id} does not have an exportable private key`);
          }
          const privateKeyPem = await kmsService.getPrivateKey(
            certificate.kmsKeyId,
            certificate.id
          );

          const keyContent = encryptPrivateKey && password
            ? forge.pki.encryptRsaPrivateKey(
                forge.pki.privateKeyFromPem(privateKeyPem),
                password,
                { algorithm: 'aes256' }
              )
            : privateKeyPem;

          return {
            content: certificatePem + '\n' + keyContent,
            extension: 'pem',
          };
        }

        case 'pkcs7':
        case 'p7b': {
          const p7 = forge.pkcs7.createSignedData();
          p7.addCertificate(forgeCert);
          p7.addCertificate(forgeCaCert);
          const p7Der = forge.asn1.toDer(p7.toAsn1()).getBytes();
          return {
            content: Buffer.from(p7Der, 'binary'),
            extension: targetFormat === 'pkcs7' ? 'p7b' : targetFormat,
            isBinary: true,
          };
        }

        case 'pkcs12':
        case 'pfx':
        case 'p12': {
          if (!certificate.kmsKeyId) {
            throw new Error(`Certificate ${certificate.id} does not have an exportable private key`);
          }
          const privateKeyPem = await kmsService.getPrivateKey(
            certificate.kmsKeyId,
            certificate.id
          );
          const forgePrivateKey = forge.pki.privateKeyFromPem(privateKeyPem);

          const pkcs12Password = encryptPrivateKey ? password! : '';
          const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
            forgePrivateKey,
            [forgeCert, forgeCaCert],
            pkcs12Password,
            {
              algorithm: encryptPrivateKey ? '3des' : undefined,
              friendlyName: certificate.subjectDn,
            }
          );
          const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
          return {
            content: Buffer.from(p12Der, 'binary'),
            extension: 'p12',
            isBinary: true,
          };
        }

        default:
          throw new Error(`Unsupported format: ${targetFormat}`);
      }
    };

    // Generate filename from certificate
    const getBaseFilename = (cert: typeof certResults[0]['certificate']) => {
      const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
      const commonName = cnMatch ? cnMatch[1].replace(/[^a-zA-Z0-9-_.]/g, '_') : 'certificate';
      const serialShort = cert.serialNumber.slice(-8);
      return `${commonName}_${serialShort}`;
    };

    // Handle JKS keystore - single file with all certs and keys
    if (format === 'jks-keystore') {
      try {
        // First, let's generate individual P12s and combine into single JKS
        // For bulk, we'll generate separate JKS files in a ZIP since combining multiple keystores is complex

        for (const { certificate, ca } of certResults) {
          if (!certificate.kmsKeyId) {
            logger.warn({ certId: certificate.id }, 'Certificate has no private key, skipping for JKS keystore');
            continue;
          }

          if (!ca) {
            logger.warn({ certId: certificate.id }, 'Certificate has no CA, skipping for JKS keystore');
            continue;
          }

          const certificatePem = await kmsService.getCertificate(
            certificate.kmsCertificateId,
            certificate.id
          );
          const privateKeyPem = await kmsService.getPrivateKey(
            certificate.kmsKeyId,
            certificate.id
          );
          const caCertificatePem = await kmsService.getCertificate(
            ca.kmsCertificateId,
            ca.id
          );

          const cnMatch = certificate.subjectDn.match(/CN=([^,]+)/);
          const commonName = cnMatch ? cnMatch[1].replace(/[^a-zA-Z0-9-_.]/g, '_') : 'certificate';
          const serialShort = certificate.serialNumber.slice(-8);

          const jksResult = await generateJKSKeystore({
            certificatePem,
            privateKeyPem,
            caCertificatePem,
            password,
            alias: commonName,
            commonName,
            serialShort,
          });

          zip.file(`${getBaseFilename(certificate)}.jks`, Buffer.from(jksResult.data, 'base64'));
        }
      } catch (jksError) {
        if (jksError instanceof JKSKeytoolError) {
          return sendError(reply, 500, 'JKS_GENERATION_FAILED', jksError.message);
        }
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create JKS keystore');
      }
    }
    // Handle JKS truststore - single file with unique CA certs only
    else if (format === 'jks-truststore') {
      try {
        // Collect unique CAs
        const caMap = new Map<string, { ca: typeof certResults[0]['ca']; pem: string }>();

        for (const { ca } of certResults) {
          if (!ca) continue;
          if (!caMap.has(ca.id)) {
            const caCertificatePem = await kmsService.getCertificate(
              ca.kmsCertificateId,
              ca.id
            );
            caMap.set(ca.id, { ca, pem: caCertificatePem });
          }
        }

        // Generate truststore with all unique CAs
        // For simplicity, use the first CA's info for naming
        const firstCa = Array.from(caMap.values())[0];
        if (!firstCa) {
          return sendError(reply, 404, 'NO_CA_FOUND', 'No CA certificates found');
        }

        const jksResult = await generateJKSTruststore({
          caCertificatePem: firstCa.pem,
          caSubjectDn: firstCa.ca!.subjectDn,
          password,
          commonName: 'truststore',
          serialShort: 'bulk',
        });

        const timestamp = new Date().toISOString().slice(0, 10);
        return {
          data: jksResult.data,
          filename: `truststore-${timestamp}.jks`,
          mimeType: jksResult.mimeType,
        };
      } catch (jksError) {
        if (jksError instanceof JKSKeytoolError) {
          return sendError(reply, 500, 'JKS_GENERATION_FAILED', jksError.message);
        }
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create JKS truststore');
      }
    }
    // Handle docker-volume format - TAR archive
    else if (format === 'docker-volume') {
      // For docker-volume, generate individual cert/key files in certs/ folder structure
      const certsFolder = zip.folder('certs');
      if (!certsFolder) {
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create ZIP structure');
      }

      // Collect unique CA certificates for chain
      const caChainPems: string[] = [];
      const seenCaIds = new Set<string>();

      for (const { certificate, ca } of certResults) {
        if (!ca) continue;

        const baseName = getBaseFilename(certificate);

        // Get certificate PEM
        const certificatePem = await kmsService.getCertificate(
          certificate.kmsCertificateId,
          certificate.id
        );
        certsFolder.file(`${baseName}.pem`, certificatePem);

        // Get private key if available
        if (certificate.kmsKeyId) {
          const privateKeyPem = await kmsService.getPrivateKey(
            certificate.kmsKeyId,
            certificate.id
          );

          const keyContent = encryptPrivateKey && password
            ? forge.pki.encryptRsaPrivateKey(
                forge.pki.privateKeyFromPem(privateKeyPem),
                password,
                { algorithm: 'aes256' }
              )
            : privateKeyPem;

          certsFolder.file(`${baseName}.key`, keyContent);
        }

        // Collect CA certificate for chain
        if (!seenCaIds.has(ca.id)) {
          const caCertificatePem = await kmsService.getCertificate(
            ca.kmsCertificateId,
            ca.id
          );
          caChainPems.push(caCertificatePem);
          seenCaIds.add(ca.id);
        }
      }

      // Add CA chain file
      if (caChainPems.length > 0) {
        certsFolder.file('ca-chain.pem', caChainPems.join('\n'));
      }
    }
    // Handle 'all' format - multiple formats for each certificate
    else if (format === 'all') {
      const simpleFormats = ['pem', 'crt', 'der', 'cer', 'pem-chain', 'pem-key', 'pkcs7', 'p7b', 'pkcs12', 'pfx', 'p12'];

      for (const { certificate, ca } of certResults) {
        if (!ca) continue;

        const baseName = getBaseFilename(certificate);
        const certFolder = zip.folder(baseName);
        if (!certFolder) continue;

        for (const fmt of simpleFormats) {
          try {
            // Skip key-requiring formats if no key
            if (['pem-key', 'pkcs12', 'pfx', 'p12'].includes(fmt) && !certificate.kmsKeyId) {
              continue;
            }

            const result = await generateCertificateFile(certificate, ca, fmt);

            if (result.isBinary && Buffer.isBuffer(result.content)) {
              certFolder.file(`${baseName}.${result.extension}`, result.content);
            } else {
              certFolder.file(`${baseName}.${result.extension}`, result.content as string);
            }
          } catch (error) {
            logger.warn({ error, certId: certificate.id, format: fmt }, 'Failed to generate format, skipping');
          }
        }
      }
    }
    // Handle simple formats - one file per certificate
    else {
      for (const { certificate, ca } of certResults) {
        if (!ca) {
          logger.warn({ certId: certificate.id }, 'Certificate has no CA, skipping');
          continue;
        }

        try {
          const result = await generateCertificateFile(certificate, ca, format);
          const baseName = getBaseFilename(certificate);

          if (result.isBinary && Buffer.isBuffer(result.content)) {
            zip.file(`${baseName}.${result.extension}`, result.content);
          } else {
            zip.file(`${baseName}.${result.extension}`, result.content as string);
          }
        } catch (error) {
          logger.warn({ error, certId: certificate.id }, 'Failed to generate certificate file, skipping');
        }
      }
    }

    // Generate ZIP file
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const timestamp = new Date().toISOString().slice(0, 10);

    // Create audit log entry
    await db.insert(auditLog).values({
      id: randomUUID(),
      operation: 'certificate.bulkDownload',
      entityType: 'bulk_operation',
      entityId: 'bulk-download',
      status: 'success',
      details: JSON.stringify({
        totalCertificates: certificateIds.length,
        format,
        encryptPrivateKey,
      }),
      ipAddress: request.ip,
    } as any);

    return {
      data: zipBuffer.toString('base64'),
      filename: `certificates-${timestamp}.zip`,
      mimeType: 'application/zip',
    };
  });
}
