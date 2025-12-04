import type { FastifyInstance, FastifyReply } from 'fastify';
import forge from 'node-forge';
import { db } from '../../db/client.js';
import { getKMSService } from '../../kms/service.js';
import {
  getCAService,
  CANotFoundError,
  CAAlreadyRevokedError,
  CANotRevokableError,
  CAHasActiveCertificatesError,
  CAOperationError,
} from '../../services/ca.service.js';
import {
  getCRLService,
  CRLCANotFoundError,
  CRLNotFoundError,
  CRLInvalidCAStatusError,
  CRLOperationError,
} from '../../services/crl.service.js';
import {
  getCertificateService,
} from '../../services/certificate.service.js';
import {
  generateJKSKeystore,
  generateJKSTruststore,
  JKSKeytoolError,
} from '../../services/jks.service.js';

// Request/Response types
interface ListCAsQuery {
  status?: 'active' | 'revoked' | 'expired';
  search?: string;
  sortBy?: 'name' | 'issuedDate' | 'expiryDate';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

interface CAIdParams {
  id: string;
}

interface CreateCABody {
  subject: {
    commonName: string;
    organization: string;
    organizationalUnit?: string;
    country: string;
    state?: string;
    locality?: string;
  };
  keyAlgorithm: string;
  validityYears?: number;
  tags?: string[];
}

interface RevokeCABody {
  reason: string;
  details?: string;
}

interface DeleteCAQuery {
  destroyKey?: boolean;
}

interface ListCertificatesQuery {
  status?: 'active' | 'revoked' | 'expired';
  certificateType?: 'server' | 'client' | 'code_signing' | 'email';
  search?: string;
  limit?: number;
  offset?: number;
}

interface ListCRLsQuery {
  limit?: number;
  offset?: number;
}

interface GenerateCRLBody {
  nextUpdateDays?: number;
}

interface DownloadCAQuery {
  format: string;
  password?: string;
}

// Inline error response schemas (to avoid $ref resolution issues in tests)
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
  if (error instanceof CANotFoundError) {
    return sendError(reply, 404, 'CA_NOT_FOUND', error.message);
  }
  if (error instanceof CAAlreadyRevokedError) {
    return sendError(reply, 409, 'CA_ALREADY_REVOKED', error.message);
  }
  if (error instanceof CANotRevokableError) {
    return sendError(reply, 409, 'CA_NOT_DELETABLE', error.message);
  }
  if (error instanceof CAHasActiveCertificatesError) {
    return sendError(reply, 409, 'CA_HAS_ACTIVE_CERTIFICATES', error.message);
  }
  if (error instanceof CAOperationError) {
    return sendError(reply, 500, 'CA_OPERATION_FAILED', error.message);
  }
  if (error instanceof CRLCANotFoundError) {
    return sendError(reply, 404, 'CA_NOT_FOUND', error.message);
  }
  if (error instanceof CRLNotFoundError) {
    return sendError(reply, 404, 'CRL_NOT_FOUND', error.message);
  }
  if (error instanceof CRLInvalidCAStatusError) {
    return sendError(reply, 409, 'INVALID_CA_STATUS', error.message);
  }
  if (error instanceof CRLOperationError) {
    return sendError(reply, 500, 'CRL_OPERATION_FAILED', error.message);
  }
  // Generic error
  return sendError(reply, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

/**
 * CA REST routes
 *
 * Endpoints:
 * - GET /cas - List CAs with filtering and pagination
 * - POST /cas - Create new CA
 * - GET /cas/:id - Get CA details
 * - POST /cas/:id/revoke - Revoke CA
 * - DELETE /cas/:id - Delete CA
 * - GET /cas/:id/certificates - List certificates issued by CA
 * - GET /cas/:id/crls - List CRLs for CA
 * - POST /cas/:id/crls - Generate new CRL
 */
export async function caRoutes(fastify: FastifyInstance): Promise<void> {
  const caService = getCAService();
  const crlService = getCRLService();
  const certificateService = getCertificateService();

  // GET /cas - List CAs with filtering and pagination
  fastify.get<{ Querystring: ListCAsQuery }>('/', {
    schema: {
      description: 'List Certificate Authorities with optional filtering, sorting, and pagination',
      tags: ['Certificate Authorities'],
      querystring: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'revoked', 'expired'],
            description: 'Filter by CA status',
          },
          search: {
            type: 'string',
            description: 'Search by subject DN',
          },
          sortBy: {
            type: 'string',
            enum: ['name', 'issuedDate', 'expiryDate'],
            default: 'issuedDate',
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
                  subject: { type: 'string' },
                  serialNumber: { type: 'string' },
                  keyAlgorithm: { type: 'string', nullable: true },
                  notBefore: { type: 'string', format: 'date-time' },
                  notAfter: { type: 'string', format: 'date-time' },
                  status: { type: 'string', enum: ['active', 'revoked', 'expired'] },
                  certificateCount: { type: 'integer' },
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
    const { status, search, sortBy, sortOrder, limit = 50, offset = 0 } = request.query;

    try {
      const items = await caService.list(
        { db, ipAddress: request.ip },
        { status, search, sortBy, sortOrder, limit: limit + 1, offset }
      );

      // Determine if there are more items
      const hasMore = items.length > limit;
      const returnItems = hasMore ? items.slice(0, limit) : items;

      return {
        items: returnItems,
        pagination: {
          total: returnItems.length + offset,
          limit,
          offset,
          hasMore,
        },
      };
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // POST /cas - Create new CA
  fastify.post<{ Body: CreateCABody }>('/', {
    schema: {
      description: 'Create a new self-signed root Certificate Authority',
      tags: ['Certificate Authorities'],
      body: {
        type: 'object',
        required: ['subject', 'keyAlgorithm'],
        properties: {
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
          keyAlgorithm: {
            type: 'string',
            enum: ['RSA-2048', 'RSA-4096'],
          },
          validityYears: {
            type: 'integer',
            minimum: 1,
            maximum: 30,
            default: 20,
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
            status: { type: 'string', enum: ['active'] },
          },
        },
        400: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await caService.create(
        { db, ipAddress: request.ip },
        request.body
      );

      reply.code(201);
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // GET /cas/:id - Get CA details
  fastify.get<{ Params: CAIdParams }>('/:id', {
    schema: {
      description: 'Get detailed information about a specific Certificate Authority',
      tags: ['Certificate Authorities'],
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
            subject: { type: 'object' },
            subjectDn: { type: 'string' },
            issuer: { type: 'object' },
            issuerDn: { type: 'string' },
            serialNumber: { type: 'string' },
            keyAlgorithm: { type: 'string' },
            notBefore: { type: 'string', format: 'date-time' },
            notAfter: { type: 'string', format: 'date-time' },
            validityStatus: { type: 'string', enum: ['valid', 'expired', 'not_yet_valid'] },
            status: { type: 'string', enum: ['active', 'revoked', 'expired'] },
            extensions: { type: 'object' },
            fingerprints: {
              type: 'object',
              properties: {
                sha256: { type: 'string' },
                sha1: { type: 'string' },
              },
            },
            certificatePem: { type: 'string' },
            issuedCertificateCount: { type: 'integer' },
            revocationDate: { type: 'string', format: 'date-time', nullable: true },
            revocationReason: { type: 'string', nullable: true },
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
      const result = await caService.getById(
        { db, ipAddress: request.ip },
        request.params.id
      );
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // POST /cas/:id/revoke - Revoke CA
  fastify.post<{ Params: CAIdParams; Body: RevokeCABody }>('/:id/revoke', {
    schema: {
      description: 'Revoke a Certificate Authority. This will also revoke all certificates issued by this CA.',
      tags: ['Certificate Authorities'],
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
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            caId: { type: 'string', format: 'uuid' },
            revocationDate: { type: 'string', format: 'date-time' },
            reason: { type: 'string' },
            cascadeRevokedCount: { type: 'integer' },
            crlGenerated: { type: 'boolean' },
            crlId: { type: 'string', format: 'uuid' },
          },
        },
        404: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await caService.revoke(
        { db, ipAddress: request.ip },
        {
          id: request.params.id,
          reason: request.body.reason,
          details: request.body.details,
        }
      );
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // DELETE /cas/:id - Delete CA
  fastify.delete<{ Params: CAIdParams; Querystring: DeleteCAQuery }>('/:id', {
    schema: {
      description: 'Delete a revoked or expired Certificate Authority. The CA must be revoked or expired and have no active certificates.',
      tags: ['Certificate Authorities'],
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
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            caId: { type: 'string', format: 'uuid' },
            keyDestroyed: { type: 'boolean' },
            crlsDeleted: { type: 'integer' },
          },
        },
        404: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await caService.delete(
        { db, ipAddress: request.ip },
        {
          id: request.params.id,
          destroyKey: request.query.destroyKey,
        }
      );
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // GET /cas/:id/certificates - List certificates issued by CA
  fastify.get<{ Params: CAIdParams; Querystring: ListCertificatesQuery }>('/:id/certificates', {
    schema: {
      description: 'List all certificates issued by a specific Certificate Authority',
      tags: ['Certificate Authorities'],
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
          status: {
            type: 'string',
            enum: ['active', 'revoked', 'expired'],
            description: 'Filter by certificate status',
          },
          certificateType: {
            type: 'string',
            enum: ['server', 'client', 'code_signing', 'email'],
            description: 'Filter by certificate type',
          },
          search: {
            type: 'string',
            description: 'Search by subject DN, serial number, or SANs',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
          offset: {
            type: 'integer',
            minimum: 0,
            default: 0,
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
                  certificateType: { type: 'string' },
                  notBefore: { type: 'string', format: 'date-time' },
                  notAfter: { type: 'string', format: 'date-time' },
                  status: { type: 'string' },
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
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { status, certificateType, search, limit = 50, offset = 0 } = request.query;
    const caId = request.params.id;

    try {
      // First verify CA exists
      await caService.getById({ db, ipAddress: request.ip }, caId);

      // Then list certificates for this CA
      const result = await certificateService.list(
        { db, ipAddress: request.ip },
        {
          caId,
          status,
          certificateType,
          search,
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

  // GET /cas/:id/crls - List CRLs for CA
  fastify.get<{ Params: CAIdParams; Querystring: ListCRLsQuery }>('/:id/crls', {
    schema: {
      description: 'List all Certificate Revocation Lists (CRLs) for a specific CA',
      tags: ['Certificate Authorities'],
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
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
          },
          offset: {
            type: 'integer',
            minimum: 0,
            default: 0,
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
                  crlNumber: { type: 'integer' },
                  thisUpdate: { type: 'string', format: 'date-time' },
                  nextUpdate: { type: 'string', format: 'date-time' },
                  validityStatus: { type: 'string', enum: ['valid', 'expired'] },
                  revokedCount: { type: 'integer' },
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
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { limit = 50, offset = 0 } = request.query;
    const caId = request.params.id;

    try {
      const result = await crlService.list(
        { db, ipAddress: request.ip },
        { caId, limit, offset }
      );

      return {
        items: result.items,
        pagination: {
          total: result.totalCount,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.offset + result.items.length < result.totalCount,
        },
      };
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // POST /cas/:id/crls - Generate new CRL
  fastify.post<{ Params: CAIdParams; Body: GenerateCRLBody }>('/:id/crls', {
    schema: {
      description: 'Generate a new Certificate Revocation List (CRL) for a specific CA',
      tags: ['Certificate Authorities'],
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
          nextUpdateDays: {
            type: 'integer',
            minimum: 1,
            maximum: 365,
            default: 7,
            description: 'Number of days until the CRL expires',
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            crlNumber: { type: 'integer' },
            thisUpdate: { type: 'string', format: 'date-time' },
            nextUpdate: { type: 'string', format: 'date-time' },
            revokedCount: { type: 'integer' },
            note: { type: 'string' },
          },
        },
        404: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await crlService.generate(
        { db, ipAddress: request.ip },
        {
          caId: request.params.id,
          nextUpdateDays: request.body?.nextUpdateDays,
        }
      );

      reply.code(201);
      return result;
    } catch (error) {
      return handleServiceError(error, reply);
    }
  });

  // GET /cas/:id/download - Download CA certificate in various formats
  fastify.get<{ Params: CAIdParams; Querystring: DownloadCAQuery }>('/:id/download', {
    schema: {
      description: `Download CA certificate in various formats.

**Certificate Formats (public certificate only):**
- \`pem\` - PEM text format (Base64-encoded with headers)
- \`crt\` - CRT text certificate (same as PEM)
- \`der\` - DER binary compact format
- \`cer\` - CER Windows-compatible format (same as DER)

**Truststore Formats (public certificate only, for trust validation):**
- \`p12-truststore\` - PKCS#12 truststore containing only the CA certificate
- \`jks-truststore\` - Java KeyStore truststore containing only the CA certificate

**Keystore Formats (certificate + private key, for CA signing operations):**
- \`p12-keystore\` - PKCS#12 keystore with CA certificate and private key
- \`jks-keystore\` - Java KeyStore with CA certificate and private key

**Security Note:** Keystore formats expose the CA's private key. Only use these for CA operations that require signing capability (e.g., offline CA scenarios).`,
      tags: ['Certificate Authorities'],
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
              'crt',
              'der',
              'cer',
              'p12-truststore',
              'p12-keystore',
              'jks-truststore',
              'jks-keystore',
            ],
            description: 'Download format',
          },
          password: {
            type: 'string',
            description: 'Password for P12 and JKS formats. Required for keystore formats, optional for truststore formats (defaults to "changeit" if not provided)',
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
    const { format, password } = request.query;
    const caId = request.params.id;

    // Validate password requirement for keystore formats (contains private key)
    const keystoreFormats = ['p12-keystore', 'jks-keystore'];
    if (keystoreFormats.includes(format) && !password) {
      return sendError(reply, 400, 'PASSWORD_REQUIRED', `Password is required for ${format} format to protect the private key`);
    }

    try {
      // Get CA details
      const ca = await caService.getById({ db, ipAddress: request.ip }, caId);
      const kmsService = getKMSService();

      // Extract CN for filename
      const cnMatch = ca.subjectDn.match(/CN=([^,]+)/);
      const commonName = cnMatch ? cnMatch[1].replace(/[^a-zA-Z0-9-_.]/g, '_') : 'ca-certificate';
      const serialShort = ca.serialNumber.slice(-8);

      // Get certificate PEM from KMS
      const certificatePem = await kmsService.getCertificate(ca.kmsCertificateId!, ca.id);

      let data: string;
      let mimeType: string;
      let filename: string;

      switch (format) {
        case 'pem':
        case 'crt':
          mimeType = 'application/x-pem-file';
          filename = `${commonName}.${format}`;
          data = Buffer.from(certificatePem).toString('base64');
          break;

        case 'der':
        case 'cer':
          mimeType = 'application/x-x509-ca-cert';
          filename = `${commonName}.${format}`;
          // Convert PEM to DER
          const base64Content = certificatePem
            .replace(/-----BEGIN CERTIFICATE-----/g, '')
            .replace(/-----END CERTIFICATE-----/g, '')
            .replace(/\s/g, '');
          data = base64Content;
          break;

        case 'p12-truststore': {
          // PKCS#12 truststore: CA certificate only (no private key)
          const forgeCert = forge.pki.certificateFromPem(certificatePem);
          const truststorePassword = password || 'changeit';

          // Create PKCS#12 with only certificate (null for private key)
          const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
            null, // No private key
            [forgeCert],
            truststorePassword,
            {
              algorithm: '3des',
              friendlyName: commonName,
            }
          );

          const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
          mimeType = 'application/x-pkcs12';
          filename = `${commonName}-${serialShort}-truststore.p12`;
          data = forge.util.encode64(p12Der);
          break;
        }

        case 'p12-keystore': {
          // PKCS#12 keystore: CA certificate + private key
          if (!ca.kmsKeyId) {
            return sendError(reply, 404, 'KEY_NOT_FOUND', 'CA has no associated private key in KMS');
          }

          const privateKeyPem = await kmsService.getPrivateKey(ca.kmsKeyId, ca.id);
          const forgeCert = forge.pki.certificateFromPem(certificatePem);
          const forgePrivateKey = forge.pki.privateKeyFromPem(privateKeyPem);

          // Create PKCS#12 with certificate and private key
          const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
            forgePrivateKey,
            [forgeCert],
            password!,
            {
              algorithm: '3des',
              friendlyName: commonName,
            }
          );

          const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
          mimeType = 'application/x-pkcs12';
          filename = `${commonName}-${serialShort}-keystore.p12`;
          data = forge.util.encode64(p12Der);
          break;
        }

        case 'jks-truststore': {
          // JKS Truststore: CA certificate only (for trust validation)
          try {
            const jksResult = await generateJKSTruststore({
              caCertificatePem: certificatePem,
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
            throw jksError;
          }
        }

        case 'jks-keystore': {
          // JKS Keystore: CA certificate + private key (for CA signing operations)
          if (!ca.kmsKeyId) {
            return sendError(reply, 404, 'KEY_NOT_FOUND', 'CA has no associated private key in KMS. JKS Keystore requires a private key.');
          }

          try {
            const privateKeyPem = await kmsService.getPrivateKey(ca.kmsKeyId, ca.id);

            // For CA keystore, CA is self-signed so CA cert is itself
            const jksResult = await generateJKSKeystore({
              certificatePem,
              privateKeyPem,
              caCertificatePem: certificatePem, // Self-signed CA
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
            throw jksError;
          }
        }

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
