import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
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
}
