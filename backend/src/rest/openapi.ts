import type { FastifyInstance } from 'fastify';
import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import type { FastifySwaggerUiOptions } from '@fastify/swagger-ui';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { openApiSchemas } from './schemas/openapi-schemas.js';

export const swaggerOptions: FastifyDynamicSwaggerOptions = {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'PKI Manager REST API',
      description: `Public Key Infrastructure (PKI) Management System REST API.

This API provides RESTful endpoints for managing Certificate Authorities (CAs),
certificates, Certificate Revocation Lists (CRLs), and related operations.

## Features
- Certificate Authority management (create, revoke, delete)
- Certificate lifecycle management (issue, renew, revoke, download)
- Bulk operations for certificates
- CRL generation and distribution
- Audit logging and reporting
- Global search across all entities

## Authentication
Currently, the API does not require authentication. Future versions will support
API key and OAuth2/OIDC authentication.

## Rate Limiting
No rate limiting is currently enforced. This may change in future versions.
`,
      version: '1.0.0',
      contact: {
        name: 'PKI Manager Team',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: '/api/v1',
        description: 'REST API v1',
      },
    ],
    tags: [
      {
        name: 'Certificate Authorities',
        description: 'Manage Certificate Authorities (CAs) - create, list, revoke, and delete root CAs',
      },
      {
        name: 'Certificates',
        description: 'Certificate lifecycle operations - issue, list, renew, revoke, download, and delete certificates',
      },
      {
        name: 'Bulk Operations',
        description: 'Batch operations for certificates - bulk issue, revoke, renew, delete, and download',
      },
      {
        name: 'CRLs',
        description: 'Certificate Revocation List operations - generate and retrieve CRLs',
      },
      {
        name: 'Search',
        description: 'Global search across CAs, certificates, and domains',
      },
      {
        name: 'Domains',
        description: 'Domain listing with certificate statistics',
      },
      {
        name: 'Dashboard',
        description: 'Dashboard statistics and expiring items',
      },
      {
        name: 'Audit',
        description: 'Audit log queries and report generation',
      },
    ],
    components: {
      schemas: {
        // Common error response (manual - not from Zod)
        Error: {
          type: 'object' as const,
          properties: {
            error: {
              type: 'object' as const,
              properties: {
                code: {
                  type: 'string' as const,
                  description: 'Error code',
                  example: 'VALIDATION_ERROR',
                },
                message: {
                  type: 'string' as const,
                  description: 'Human-readable error message',
                  example: 'Invalid input',
                },
                details: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      field: { type: 'string' as const },
                      message: { type: 'string' as const },
                    },
                  },
                  description: 'Detailed validation errors',
                },
              },
              required: ['code', 'message'],
            },
          },
          required: ['error'],
        },
        // Pagination response wrapper (manual - not from Zod)
        Pagination: {
          type: 'object' as const,
          properties: {
            total: {
              type: 'integer' as const,
              description: 'Total number of items',
            },
            limit: {
              type: 'integer' as const,
              description: 'Maximum items per page',
            },
            offset: {
              type: 'integer' as const,
              description: 'Current offset',
            },
            hasMore: {
              type: 'boolean' as const,
              description: 'Whether more items are available',
            },
          },
          required: ['total', 'limit', 'offset', 'hasMore'],
        },

        // === Schemas generated from Zod via zod-to-json-schema ===

        // Common/Enum schemas
        SubjectDN: openApiSchemas.SubjectDN,
        CertificateStatus: openApiSchemas.CertificateStatus,
        CertificateType: openApiSchemas.CertificateType,
        KeyAlgorithm: openApiSchemas.KeyAlgorithm,
        RevocationReason: openApiSchemas.RevocationReason,

        // CA Request schemas
        CreateCaRequest: openApiSchemas.CreateCaRequest,
        ListCasRequest: openApiSchemas.ListCasRequest,
        RevokeCaRequest: openApiSchemas.RevokeCaRequest,
        DeleteCaRequest: openApiSchemas.DeleteCaRequest,

        // Certificate Request schemas
        CreateCertificateRequest: openApiSchemas.CreateCertificateRequest,
        ListCertificatesRequest: openApiSchemas.ListCertificatesRequest,
        RenewCertificateRequest: openApiSchemas.RenewCertificateRequest,
        RevokeCertificateRequest: openApiSchemas.RevokeCertificateRequest,
        DeleteCertificateRequest: openApiSchemas.DeleteCertificateRequest,
        DownloadCertificateRequest: openApiSchemas.DownloadCertificateRequest,
        CertificateDetail: openApiSchemas.CertificateDetail,

        // Bulk Operation schemas
        BulkCreateCertificatesRequest: openApiSchemas.BulkCreateCertificatesRequest,
        BulkRevokeCertificatesRequest: openApiSchemas.BulkRevokeCertificatesRequest,
        BulkRenewCertificatesRequest: openApiSchemas.BulkRenewCertificatesRequest,
        BulkDeleteCertificatesRequest: openApiSchemas.BulkDeleteCertificatesRequest,
        BulkDownloadCertificatesRequest: openApiSchemas.BulkDownloadCertificatesRequest,

        // CRL schemas
        GenerateCrlRequest: openApiSchemas.GenerateCrlRequest,
        GetCrlRequest: openApiSchemas.GetCrlRequest,
        ListCrlsRequest: openApiSchemas.ListCrlsRequest,

        // Audit schemas
        ListAuditLogRequest: openApiSchemas.ListAuditLogRequest,
        GenerateReportRequest: openApiSchemas.GenerateReportRequest,
      },
      responses: {
        BadRequest: {
          description: 'Bad Request - Invalid input parameters',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        Conflict: {
          description: 'Conflict - Resource state prevents operation',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        InternalError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
  },
};

export const swaggerUiOptions: FastifySwaggerUiOptions = {
  routePrefix: '/api/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
    syntaxHighlight: {
      theme: 'monokai',
    },
  },
  staticCSP: true,
};

export async function registerOpenAPI(fastify: FastifyInstance): Promise<void> {
  // Register Swagger for OpenAPI spec generation
  await fastify.register(swagger, swaggerOptions);

  // Register Swagger UI
  await fastify.register(swaggerUi, swaggerUiOptions);
}
