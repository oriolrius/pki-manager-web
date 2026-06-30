import type { FastifyInstance, FastifyReply } from 'fastify';
import { createPkcs12Bundle, encryptPrivateKeyPem } from '../../crypto/pkcs12.js';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { certificates, certificateAuthorities } from '../../db/schema.js';
import { getKMSService } from '../../kms/service.js';
import {
  getCertificateService,
  CertificateNotFoundError,
  CertificateNoCAError,
  CertificateCANotFoundError,
  CertificateCANotActiveError,
  CertificateCAExpiredError,
  CertificateValidationError,
  CertificateRevokedError,
  CertificateAlreadyRevokedError,
  CertificateKeyReuseError,
  CertificateNoKeyError,
  CertificateNotDeletableError,
  CertificateOperationError,
} from '../../services/certificate.service.js';
import {
  generateJKSKeystore,
  generateJKSTruststore,
  JKSKeytoolError,
} from '../../services/jks.service.js';

// Request/Response types
interface ListCertificatesQuery {
  status?: 'active' | 'revoked' | 'expired';
  type?: 'server' | 'client' | 'dual' | 'code_signing' | 'email';
  caId?: string;
  search?: string;
  sortBy?: 'createdAt' | 'notAfter' | 'subjectDn';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

interface CertificateIdParams {
  id: string;
}

interface IssueCertificateBody {
  caId: string;
  subject: {
    commonName: string;
    organization: string;
    organizationalUnit?: string;
    country: string;
    state?: string;
    locality?: string;
  };
  certificateType: 'server' | 'client' | 'dual' | 'code_signing' | 'email';
  keyAlgorithm: string;
  validityDays: number;
  sanDns?: string[];
  sanIp?: string[];
  sanEmail?: string[];
  tags?: string[];
}

interface RenewCertificateBody {
  generateNewKey?: boolean;
  validityDays?: number;
  updateInfo?: boolean;
  subject?: {
    commonName: string;
    organization: string;
    organizationalUnit?: string;
    country: string;
    state?: string;
    locality?: string;
  };
  sanDns?: string[];
  sanIp?: string[];
  sanEmail?: string[];
  revokeOriginal?: boolean;
}

interface RevokeCertificateBody {
  reason: string;
  details?: string;
  effectiveDate?: number;
  generateCrl?: boolean;
}

interface DeleteCertificateQuery {
  destroyKey?: boolean;
  removeFromCrl?: boolean;
}

interface DownloadCertificateQuery {
  format: string;
  password?: string;
  encryptPrivateKey?: boolean;
  includeChain?: boolean;
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

// Map service errors to HTTP responses
function handleServiceError(error: unknown, reply: FastifyReply) {
  if (error instanceof CertificateNotFoundError) {
    return sendError(reply, 404, 'CERTIFICATE_NOT_FOUND', error.message);
  }
  if (error instanceof CertificateNoCAError) {
    return sendError(reply, 500, 'CERTIFICATE_NO_CA', error.message);
  }
  if (error instanceof CertificateCANotFoundError) {
    return sendError(reply, 404, 'CA_NOT_FOUND', error.message);
  }
  if (error instanceof CertificateCANotActiveError) {
    return sendError(reply, 409, 'CA_NOT_ACTIVE', error.message);
  }
  if (error instanceof CertificateCAExpiredError) {
    return sendError(reply, 409, 'CA_EXPIRED', error.message);
  }
  if (error instanceof CertificateValidationError) {
    return sendError(reply, 400, 'VALIDATION_ERROR', error.message);
  }
  if (error instanceof CertificateRevokedError) {
    return sendError(reply, 409, 'CERTIFICATE_REVOKED', error.message);
  }
  if (error instanceof CertificateAlreadyRevokedError) {
    return sendError(reply, 409, 'CERTIFICATE_ALREADY_REVOKED', error.message);
  }
  if (error instanceof CertificateKeyReuseError) {
    return sendError(reply, 409, 'KEY_REUSE_NOT_ALLOWED', error.message);
  }
  if (error instanceof CertificateNoKeyError) {
    return sendError(reply, 409, 'CERTIFICATE_NO_KEY', error.message);
  }
  if (error instanceof CertificateNotDeletableError) {
    return sendError(reply, 409, 'CERTIFICATE_NOT_DELETABLE', error.message);
  }
  if (error instanceof CertificateOperationError) {
    return sendError(reply, 500, 'CERTIFICATE_OPERATION_FAILED', error.message);
  }
  // Generic error
  return sendError(reply, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

/**
 * Certificate REST routes
 *
 * Endpoints:
 * - GET /certificates - List certificates with filtering and pagination
 * - POST /certificates - Issue a new certificate
 * - GET /certificates/:id - Get certificate details
 * - POST /certificates/:id/renew - Renew a certificate
 * - POST /certificates/:id/revoke - Revoke a certificate
 * - DELETE /certificates/:id - Delete a certificate
 * - GET /certificates/:id/download - Download certificate in various formats
 */
export async function certificateRoutes(fastify: FastifyInstance): Promise<void> {
  const certificateService = getCertificateService();

  // GET /certificates - List certificates with filtering and pagination
  fastify.get<{ Querystring: ListCertificatesQuery }>('/', {
    schema: {
      description: 'List certificates with optional filtering, sorting, and pagination',
      tags: ['Certificates'],
      querystring: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'revoked', 'expired'],
            description: 'Filter by certificate status',
          },
          type: {
            type: 'string',
            enum: ['server', 'client', 'dual', 'code_signing', 'email'],
            description: 'Filter by certificate type',
          },
          caId: {
            type: 'string',
            format: 'uuid',
            description: 'Filter by issuing CA',
          },
          search: {
            type: 'string',
            description: 'Search by subject DN, serial number, or SANs',
          },
          sortBy: {
            type: 'string',
            enum: ['createdAt', 'notAfter', 'subjectDn'],
            default: 'createdAt',
            description: 'Sort field',
          },
          sortOrder: {
            type: 'string',
            enum: ['asc', 'desc'],
            default: 'desc',
            description: 'Sort order',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
            description: 'Maximum number of items to return',
          },
          offset: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Number of items to skip',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  caId: { type: 'string', format: 'uuid' },
                  subjectDn: { type: 'string' },
                  serialNumber: { type: 'string' },
                  certificateType: { type: 'string', enum: ['server', 'client', 'dual', 'code_signing', 'email'] },
                  notBefore: { type: 'string', format: 'date-time' },
                  notAfter: { type: 'string', format: 'date-time' },
                  status: { type: 'string', enum: ['active', 'revoked', 'expired'] },
                  expiryStatus: { type: 'string', enum: ['active', 'expired', 'expiring_soon'] },
                  sanDns: { type: 'array', items: { type: 'string' }, nullable: true },
                  sanIp: { type: 'array', items: { type: 'string' }, nullable: true },
                  sanEmail: { type: 'array', items: { type: 'string' }, nullable: true },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
                hasMore: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { status, type, caId, search, sortBy, sortOrder, limit = 50, offset = 0 } = request.query;

    try {
      const result = await certificateService.list(
        { db, ipAddress: request.ip },
        {
          status,
          certificateType: type,
          caId,
          search,
          sortBy,
          sortOrder,
          limit: limit + 1,
          offset,
        }
      );

      // Determine if there are more items
      const hasMore = result.items.length > limit;
      const returnItems = hasMore ? result.items.slice(0, limit) : result.items;

      // Format the response
      const formattedItems = returnItems.map(cert => ({
        id: cert.id,
        caId: cert.caId,
        subjectDn: cert.subjectDn,
        serialNumber: cert.serialNumber,
        certificateType: cert.certificateType,
        notBefore: cert.notBefore instanceof Date ? cert.notBefore.toISOString() : cert.notBefore,
        notAfter: cert.notAfter instanceof Date ? cert.notAfter.toISOString() : cert.notAfter,
        status: cert.status,
        expiryStatus: cert.expiryStatus,
        sanDns: cert.sanDns,
        sanIp: cert.sanIp,
        sanEmail: cert.sanEmail,
        createdAt: cert.createdAt instanceof Date ? cert.createdAt.toISOString() : cert.createdAt,
      }));

      return {
        items: formattedItems,
        pagination: {
          total: result.totalCount,
          limit,
          offset,
          hasMore,
        },
      };
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // POST /certificates - Issue a new certificate
  fastify.post<{ Body: IssueCertificateBody }>('/', {
    schema: {
      description: 'Issue a new certificate signed by a Certificate Authority',
      tags: ['Certificates'],
      body: {
        type: 'object',
        required: ['caId', 'subject', 'certificateType', 'keyAlgorithm', 'validityDays'],
        properties: {
          caId: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the issuing CA',
          },
          subject: {
            type: 'object',
            required: ['commonName', 'organization', 'country'],
            properties: {
              commonName: { type: 'string', minLength: 1, maxLength: 64 },
              organization: { type: 'string', minLength: 1, maxLength: 64 },
              organizationalUnit: { type: 'string', maxLength: 64 },
              country: { type: 'string', minLength: 2, maxLength: 2 },
              state: { type: 'string', maxLength: 64 },
              locality: { type: 'string', maxLength: 64 },
            },
          },
          certificateType: {
            type: 'string',
            enum: ['server', 'client', 'dual', 'code_signing', 'email'],
          },
          keyAlgorithm: {
            type: 'string',
            enum: ['RSA-2048', 'RSA-4096', 'ECDSA-P256', 'ECDSA-P384'],
          },
          validityDays: {
            type: 'integer',
            minimum: 1,
            maximum: 825,
            description: 'Validity period in days',
          },
          sanDns: {
            type: 'array',
            items: { type: 'string' },
            description: 'DNS Subject Alternative Names',
          },
          sanIp: {
            type: 'array',
            items: { type: 'string' },
            description: 'IP Subject Alternative Names',
          },
          sanEmail: {
            type: 'array',
            items: { type: 'string', format: 'email' },
            description: 'Email Subject Alternative Names',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            subject: { type: 'string' },
            serialNumber: { type: 'string' },
            notBefore: { type: 'string', format: 'date-time' },
            notAfter: { type: 'string', format: 'date-time' },
            certificatePem: { type: 'string' },
            status: { type: 'string', enum: ['active'] },
          },
        },
        400: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await certificateService.issue(
        { db, ipAddress: request.ip },
        request.body
      );

      reply.code(201);
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // GET /certificates/:id - Get certificate details
  fastify.get<{ Params: CertificateIdParams }>('/:id', {
    schema: {
      description: 'Get detailed information about a specific certificate',
      tags: ['Certificates'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            caId: { type: 'string', format: 'uuid' },
            serialNumber: { type: 'string' },
            certificateType: { type: 'string' },
            status: { type: 'string', enum: ['active', 'revoked', 'expired'] },
            subjectDn: { type: 'string' },
            subject: { type: 'object' },
            issuerDn: { type: 'string' },
            issuer: { type: 'object' },
            notBefore: { type: 'string', format: 'date-time' },
            notAfter: { type: 'string', format: 'date-time' },
            validityStatus: { type: 'string', enum: ['valid', 'expired', 'not_yet_valid'] },
            remainingDays: { type: 'integer', nullable: true },
            keyUsage: { type: 'object', nullable: true },
            extendedKeyUsage: { type: 'array', items: { type: 'string' }, nullable: true },
            sanDns: { type: 'array', items: { type: 'string' }, nullable: true },
            sanIp: { type: 'array', items: { type: 'string' }, nullable: true },
            sanEmail: { type: 'array', items: { type: 'string' }, nullable: true },
            basicConstraints: { type: 'object', nullable: true },
            fingerprints: {
              type: 'object',
              properties: {
                sha256: { type: 'string' },
                sha1: { type: 'string' },
              },
            },
            issuingCA: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                subjectDn: { type: 'string' },
                serialNumber: { type: 'string' },
              },
            },
            certificatePem: { type: 'string' },
            kmsKeyId: { type: 'string', nullable: true },
            revocationDate: { type: 'string', format: 'date-time', nullable: true },
            revocationReason: { type: 'string', nullable: true },
            renewedFromId: { type: 'string', format: 'uuid', nullable: true },
            renewedTo: { type: 'array', items: { type: 'object' }, nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await certificateService.getById(
        { db, ipAddress: request.ip },
        request.params.id
      );
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // POST /certificates/:id/renew - Renew a certificate
  fastify.post<{ Params: CertificateIdParams; Body: RenewCertificateBody }>('/:id/renew', {
    schema: {
      description: 'Renew an existing certificate, optionally with new key or updated information',
      tags: ['Certificates'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
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
          updateInfo: {
            type: 'boolean',
            default: false,
            description: 'Update subject or SANs with new values',
          },
          subject: {
            type: 'object',
            properties: {
              commonName: { type: 'string', minLength: 1, maxLength: 64 },
              organization: { type: 'string', minLength: 1, maxLength: 64 },
              organizationalUnit: { type: 'string', maxLength: 64 },
              country: { type: 'string', minLength: 2, maxLength: 2 },
              state: { type: 'string', maxLength: 64 },
              locality: { type: 'string', maxLength: 64 },
            },
            description: 'New subject information (requires updateInfo=true)',
          },
          sanDns: {
            type: 'array',
            items: { type: 'string' },
            description: 'New DNS SANs (requires updateInfo=true)',
          },
          sanIp: {
            type: 'array',
            items: { type: 'string' },
            description: 'New IP SANs (requires updateInfo=true)',
          },
          sanEmail: {
            type: 'array',
            items: { type: 'string', format: 'email' },
            description: 'New Email SANs (requires updateInfo=true)',
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
            id: { type: 'string', format: 'uuid' },
            subject: { type: 'string' },
            serialNumber: { type: 'string' },
            notBefore: { type: 'string', format: 'date-time' },
            notAfter: { type: 'string', format: 'date-time' },
            certificatePem: { type: 'string' },
            status: { type: 'string', enum: ['active'] },
            renewedFromId: { type: 'string', format: 'uuid' },
          },
        },
        404: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await certificateService.renew(
        { db, ipAddress: request.ip },
        {
          id: request.params.id,
          ...request.body,
        }
      );

      reply.code(201);
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // POST /certificates/:id/revoke - Revoke a certificate
  fastify.post<{ Params: CertificateIdParams; Body: RevokeCertificateBody }>('/:id/revoke', {
    schema: {
      description: 'Revoke a certificate',
      tags: ['Certificates'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: {
            type: 'string',
            enum: [
              'unspecified',
              'keyCompromise',
              'caCompromise',
              'affiliationChanged',
              'superseded',
              'cessationOfOperation',
              'certificateHold',
              'removeFromCRL',
            ],
          },
          details: { type: 'string', maxLength: 500 },
          effectiveDate: {
            type: 'integer',
            description: 'Unix timestamp for effective revocation date',
          },
          generateCrl: {
            type: 'boolean',
            default: false,
            description: 'Generate a new CRL after revocation',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['revoked'] },
            revocationDate: { type: 'string', format: 'date-time' },
            revocationReason: { type: 'string' },
          },
        },
        404: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await certificateService.revoke(
        { db, ipAddress: request.ip },
        {
          id: request.params.id,
          ...request.body,
        }
      );
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // DELETE /certificates/:id - Delete a certificate
  fastify.delete<{ Params: CertificateIdParams; Querystring: DeleteCertificateQuery }>('/:id', {
    schema: {
      description: 'Delete a revoked or expired certificate. Certificate must be revoked or expired for more than 90 days.',
      tags: ['Certificates'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          destroyKey: {
            type: 'boolean',
            default: false,
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
            id: { type: 'string', format: 'uuid' },
            deleted: { type: 'boolean' },
            kmsKeyDestroyed: { type: 'boolean' },
          },
        },
        404: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await certificateService.delete(
        { db, ipAddress: request.ip },
        {
          id: request.params.id,
          destroyKey: request.query.destroyKey,
          removeFromCrl: request.query.removeFromCrl,
        }
      );
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // GET /certificates/:id/download - Download certificate in various formats
  fastify.get<{ Params: CertificateIdParams; Querystring: DownloadCertificateQuery }>('/:id/download', {
    schema: {
      description: 'Download certificate in various formats',
      tags: ['Certificates'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        required: ['format'],
        properties: {
          format: {
            type: 'string',
            enum: [
              'pem',
              'der',
              'p12',
              'pfx',
              'jks-keystore',
              'jks-truststore',
              'chain-pem',
              'key-pem',
              'key-der',
              'pkcs8-pem',
              'pkcs8-der',
              'pkcs8-encrypted',
              'full-pem',
              'full-der',
              'csr-pem',
            ],
            description: 'Download format',
          },
          password: {
            type: 'string',
            description: 'Password for encrypted formats (P12, JKS, encrypted PKCS8)',
          },
          encryptPrivateKey: {
            type: 'boolean',
            default: false,
            description: 'Encrypt the private key',
          },
          includeChain: {
            type: 'boolean',
            default: true,
            description: 'Include certificate chain',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'string', description: 'Base64-encoded certificate data' },
            mimeType: { type: 'string' },
            filename: { type: 'string' },
          },
        },
        400: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { format, password, encryptPrivateKey, includeChain } = request.query;

    // Validate password requirement for encrypted formats
    // Note: JKS formats use 'changeit' as default if no password provided
    const passwordRequiredFormats = ['p12', 'pfx', 'pkcs8-encrypted'];
    if (passwordRequiredFormats.includes(format) && !password) {
      return sendError(reply, 400, 'PASSWORD_REQUIRED', `Password is required for ${format} format`);
    }

    try {
      // Get the certificate
      const cert = await certificateService.getById(
        { db, ipAddress: request.ip },
        request.params.id
      );

      // Determine MIME type and filename
      let mimeType: string;
      let filename: string;
      let data: string;

      const baseName = cert.subjectDn.replace(/[^a-zA-Z0-9]/g, '_');

      switch (format) {
        case 'pem':
          mimeType = 'application/x-pem-file';
          filename = `${baseName}.crt`;
          data = Buffer.from(cert.certificatePem).toString('base64');
          break;

        case 'der':
          mimeType = 'application/x-x509-ca-cert';
          filename = `${baseName}.cer`;
          // Convert PEM to DER
          const pemContent = cert.certificatePem;
          const base64Content = pemContent
            .replace(/-----BEGIN CERTIFICATE-----/g, '')
            .replace(/-----END CERTIFICATE-----/g, '')
            .replace(/\s/g, '');
          data = base64Content;
          break;

        case 'chain-pem':
          mimeType = 'application/x-pem-file';
          filename = `${baseName}_chain.pem`;
          // For now, just return the certificate (chain would need CA cert)
          data = Buffer.from(cert.certificatePem).toString('base64');
          break;

        case 'key-pem':
        case 'pkcs8-pem':
          // Fetch private key from KMS (returned as PKCS#8 PEM)
          if (!cert.kmsKeyId) {
            return sendError(reply, 404, 'KEY_NOT_FOUND', 'Certificate has no associated private key in KMS');
          }
          try {
            const kmsService = getKMSService();
            const privateKeyPem = await kmsService.getPrivateKey(cert.kmsKeyId, cert.id);
            mimeType = 'application/x-pem-file';
            filename = `${baseName}.key`;
            data = Buffer.from(privateKeyPem).toString('base64');
          } catch (kmsError) {
            return sendError(reply, 500, 'KMS_ERROR', 'Failed to retrieve private key from KMS');
          }
          break;

        case 'key-der':
        case 'pkcs8-der':
          // Fetch private key from KMS and convert to DER
          if (!cert.kmsKeyId) {
            return sendError(reply, 404, 'KEY_NOT_FOUND', 'Certificate has no associated private key in KMS');
          }
          try {
            const kmsService = getKMSService();
            const privateKeyPem = await kmsService.getPrivateKey(cert.kmsKeyId, cert.id);
            // Convert PEM to DER by removing headers and decoding base64
            const keyBase64 = privateKeyPem
              .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, '')
              .replace(/-----END (RSA )?PRIVATE KEY-----/g, '')
              .replace(/\s/g, '');
            mimeType = 'application/pkcs8';
            filename = `${baseName}.key`;
            data = keyBase64;
          } catch (kmsError) {
            return sendError(reply, 500, 'KMS_ERROR', 'Failed to retrieve private key from KMS');
          }
          break;

        case 'pkcs8-encrypted':
          // Encrypted private key requires password
          if (!cert.kmsKeyId) {
            return sendError(reply, 404, 'KEY_NOT_FOUND', 'Certificate has no associated private key in KMS');
          }
          try {
            const kmsService = getKMSService();
            const privateKeyPem = await kmsService.getPrivateKey(cert.kmsKeyId, cert.id);
            // Encrypt with password via openssl (supports RSA + EC).
            const encryptedPem = await encryptPrivateKeyPem(privateKeyPem, password!);
            mimeType = 'application/x-pem-file';
            filename = `${baseName}_encrypted.key`;
            data = Buffer.from(encryptedPem).toString('base64');
          } catch (kmsError) {
            return sendError(reply, 500, 'KMS_ERROR', 'Failed to retrieve or encrypt private key');
          }
          break;

        case 'p12':
        case 'pfx':
          // PKCS#12 bundle: certificate + private key
          if (!cert.kmsKeyId) {
            return sendError(reply, 404, 'KEY_NOT_FOUND', 'Certificate has no associated private key in KMS');
          }
          try {
            const kmsService = getKMSService();
            const privateKeyPem = await kmsService.getPrivateKey(cert.kmsKeyId, cert.id);

            // Create PKCS#12 via openssl (supports RSA + EC; node-forge cannot encode EC keys).
            const p12Buffer = await createPkcs12Bundle({
              certPem: cert.certificatePem!,
              privateKeyPem,
              password: password!,
              friendlyName: cert.subjectDn,
            });

            mimeType = 'application/x-pkcs12';
            filename = `${baseName}.p12`;
            data = p12Buffer.toString('base64');
          } catch (kmsError) {
            return sendError(reply, 500, 'KMS_ERROR', 'Failed to create P12 bundle');
          }
          break;

        case 'jks-keystore': {
          // JKS Keystore: certificate + private key + CA chain
          if (!cert.kmsKeyId) {
            return sendError(reply, 404, 'KEY_NOT_FOUND', 'Certificate has no associated private key in KMS. JKS Keystore requires a private key.');
          }

          try {
            const kmsService = getKMSService();

            // Get private key from KMS
            const privateKeyPem = await kmsService.getPrivateKey(cert.kmsKeyId, cert.id);

            // Get CA certificate from KMS
            // First, fetch the CA info from database
            const caResult = await db
              .select()
              .from(certificateAuthorities)
              .where(eq(certificateAuthorities.id, cert.caId))
              .limit(1);

            if (!caResult || caResult.length === 0) {
              return sendError(reply, 404, 'CA_NOT_FOUND', 'Issuing CA not found');
            }

            const ca = caResult[0];
            const caCertificatePem = await kmsService.getCertificate(ca.kmsCertificateId, ca.id);

            // Extract common name and serial for filename
            const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
            const commonName = cnMatch ? cnMatch[1].replace(/[^a-zA-Z0-9-_.]/g, '_') : 'certificate';
            const serialShort = cert.serialNumber.slice(-8);

            // Generate JKS keystore using shared service
            const jksResult = await generateJKSKeystore({
              certificatePem: cert.certificatePem,
              privateKeyPem,
              caCertificatePem,
              password,
              alias: commonName,
              commonName,
              serialShort,
            });

            return jksResult;
          } catch (jksError) {
            if (jksError instanceof JKSKeytoolError) {
              return sendError(reply, 500, 'JKS_GENERATION_FAILED', jksError.message);
            }
            return sendError(reply, 500, 'KMS_ERROR', 'Failed to create JKS keystore');
          }
        }

        case 'jks-truststore': {
          // JKS Truststore: CA certificate only (for trust validation)
          try {
            const kmsService = getKMSService();

            // Get CA certificate from KMS
            const caResult = await db
              .select()
              .from(certificateAuthorities)
              .where(eq(certificateAuthorities.id, cert.caId))
              .limit(1);

            if (!caResult || caResult.length === 0) {
              return sendError(reply, 404, 'CA_NOT_FOUND', 'Issuing CA not found');
            }

            const ca = caResult[0];
            const caCertificatePem = await kmsService.getCertificate(ca.kmsCertificateId, ca.id);

            // Extract common name and serial for filename
            const cnMatch = cert.subjectDn.match(/CN=([^,]+)/);
            const commonName = cnMatch ? cnMatch[1].replace(/[^a-zA-Z0-9-_.]/g, '_') : 'certificate';
            const serialShort = cert.serialNumber.slice(-8);

            // Generate JKS truststore using shared service
            const jksResult = await generateJKSTruststore({
              caCertificatePem,
              caSubjectDn: ca.subjectDn,
              password,
              commonName,
              serialShort,
            });

            return jksResult;
          } catch (jksError) {
            if (jksError instanceof JKSKeytoolError) {
              return sendError(reply, 500, 'JKS_GENERATION_FAILED', jksError.message);
            }
            return sendError(reply, 500, 'KMS_ERROR', 'Failed to create JKS truststore');
          }
        }

        case 'full-pem':
          // Full PEM: certificate + private key in one file
          if (!cert.kmsKeyId) {
            return sendError(reply, 404, 'KEY_NOT_FOUND', 'Certificate has no associated private key in KMS');
          }
          try {
            const kmsService = getKMSService();
            const privateKeyPem = await kmsService.getPrivateKey(cert.kmsKeyId, cert.id);
            const fullPem = cert.certificatePem + '\n' + privateKeyPem;
            mimeType = 'application/x-pem-file';
            filename = `${baseName}_full.pem`;
            data = Buffer.from(fullPem).toString('base64');
          } catch (kmsError) {
            return sendError(reply, 500, 'KMS_ERROR', 'Failed to retrieve private key from KMS');
          }
          break;

        case 'full-der':
          // Full DER is essentially P12 format
          return sendError(reply, 400, 'USE_P12',
            'For bundled certificate + key in binary format, use P12/PFX format instead');

        case 'csr-pem':
          // CSR cannot be regenerated from a certificate - it's created before signing
          return sendError(reply, 400, 'CSR_NOT_AVAILABLE',
            'CSR is not stored after certificate issuance. CSRs are only available during the certificate request process.');

        default:
          return sendError(reply, 400, 'INVALID_FORMAT', `Unsupported format: ${format}`);
      }

      return {
        data,
        mimeType,
        filename,
      };
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });
}
