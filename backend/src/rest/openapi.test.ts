/**
 * REST API OpenAPI 3.1.0 Specification Tests
 *
 * Tests to validate:
 * 1. OpenAPI 3.1.0 spec structure and compliance
 * 2. Zod-to-JSON-Schema converted schemas are valid
 * 3. All required components are present
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerOpenAPI, swaggerOptions } from './openapi.js';
import { openApiSchemas } from './schemas/openapi-schemas.js';

describe('REST API OpenAPI 3.1.0 Specification', () => {
  let app: FastifyInstance;
  let openApiSpec: Record<string, unknown>;

  beforeAll(async () => {
    app = Fastify();
    await registerOpenAPI(app);

    // Register a dummy route to ensure swagger generates
    app.get('/api/v1/health', {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
            },
          },
        },
      },
    }, async () => ({ status: 'ok' }));

    await app.ready();
    openApiSpec = app.swagger() as Record<string, unknown>;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('OpenAPI Version', () => {
    it('should be OpenAPI 3.1.0', () => {
      expect(openApiSpec.openapi).toBe('3.1.0');
    });
  });

  describe('Info Object', () => {
    it('should have required info fields', () => {
      const info = openApiSpec.info as Record<string, unknown>;
      expect(info).toBeDefined();
      expect(info.title).toBe('PKI Manager REST API');
      expect(info.version).toBe('1.0.0');
      expect(info.description).toBeDefined();
    });

    it('should have contact information', () => {
      const info = openApiSpec.info as Record<string, unknown>;
      expect(info.contact).toBeDefined();
    });

    it('should have license information', () => {
      const info = openApiSpec.info as Record<string, unknown>;
      expect(info.license).toBeDefined();
      expect((info.license as Record<string, unknown>).name).toBe('MIT');
    });
  });

  describe('Servers', () => {
    it('should have servers defined', () => {
      const servers = openApiSpec.servers as Array<Record<string, unknown>>;
      expect(servers).toBeDefined();
      expect(servers).toHaveLength(1);
      expect(servers[0].url).toBe('/api/v1');
      expect(servers[0].description).toBe('REST API v1');
    });
  });

  describe('Tags', () => {
    it('should have all expected tags', () => {
      const tags = openApiSpec.tags as Array<Record<string, unknown>>;
      expect(tags).toBeDefined();

      const tagNames = tags.map((t) => t.name);
      expect(tagNames).toContain('Certificate Authorities');
      expect(tagNames).toContain('Certificates');
      expect(tagNames).toContain('Bulk Operations');
      expect(tagNames).toContain('CRLs');
      expect(tagNames).toContain('Search');
      expect(tagNames).toContain('Dashboard');
      expect(tagNames).toContain('Audit');
    });

    it('should have descriptions for all tags', () => {
      const tags = openApiSpec.tags as Array<Record<string, unknown>>;
      tags.forEach((tag) => {
        expect(tag.description).toBeDefined();
        expect(typeof tag.description).toBe('string');
        expect((tag.description as string).length).toBeGreaterThan(0);
      });
    });
  });

  describe('Components - Schemas', () => {
    it('should have components.schemas defined', () => {
      const components = openApiSpec.components as Record<string, unknown>;
      expect(components).toBeDefined();
      expect(components.schemas).toBeDefined();
    });

    it('should have Error schema', () => {
      const components = openApiSpec.components as Record<string, unknown>;
      const schemas = components.schemas as Record<string, unknown>;
      expect(schemas.Error).toBeDefined();
    });

    it('should have Pagination schema', () => {
      const components = openApiSpec.components as Record<string, unknown>;
      const schemas = components.schemas as Record<string, unknown>;
      expect(schemas.Pagination).toBeDefined();
    });

    it('should have Zod-converted enum schemas', () => {
      const components = openApiSpec.components as Record<string, unknown>;
      const schemas = components.schemas as Record<string, unknown>;

      expect(schemas.SubjectDN).toBeDefined();
      expect(schemas.CertificateStatus).toBeDefined();
      expect(schemas.CertificateType).toBeDefined();
      expect(schemas.KeyAlgorithm).toBeDefined();
      expect(schemas.RevocationReason).toBeDefined();
    });

    it('should have Zod-converted CA request schemas', () => {
      const components = openApiSpec.components as Record<string, unknown>;
      const schemas = components.schemas as Record<string, unknown>;

      expect(schemas.CreateCaRequest).toBeDefined();
      expect(schemas.ListCasRequest).toBeDefined();
      expect(schemas.RevokeCaRequest).toBeDefined();
      expect(schemas.DeleteCaRequest).toBeDefined();
    });

    it('should have Zod-converted certificate request schemas', () => {
      const components = openApiSpec.components as Record<string, unknown>;
      const schemas = components.schemas as Record<string, unknown>;

      expect(schemas.CreateCertificateRequest).toBeDefined();
      expect(schemas.ListCertificatesRequest).toBeDefined();
      expect(schemas.RenewCertificateRequest).toBeDefined();
      expect(schemas.RevokeCertificateRequest).toBeDefined();
      expect(schemas.DeleteCertificateRequest).toBeDefined();
      expect(schemas.DownloadCertificateRequest).toBeDefined();
      expect(schemas.CertificateDetail).toBeDefined();
    });

    it('should have Zod-converted bulk operation schemas', () => {
      const components = openApiSpec.components as Record<string, unknown>;
      const schemas = components.schemas as Record<string, unknown>;

      expect(schemas.BulkCreateCertificatesRequest).toBeDefined();
      expect(schemas.BulkRevokeCertificatesRequest).toBeDefined();
      expect(schemas.BulkRenewCertificatesRequest).toBeDefined();
      expect(schemas.BulkDeleteCertificatesRequest).toBeDefined();
      expect(schemas.BulkDownloadCertificatesRequest).toBeDefined();
    });

    it('should have Zod-converted CRL schemas', () => {
      const components = openApiSpec.components as Record<string, unknown>;
      const schemas = components.schemas as Record<string, unknown>;

      expect(schemas.GenerateCrlRequest).toBeDefined();
      expect(schemas.GetCrlRequest).toBeDefined();
      expect(schemas.ListCrlsRequest).toBeDefined();
    });

    it('should have Zod-converted audit schemas', () => {
      const components = openApiSpec.components as Record<string, unknown>;
      const schemas = components.schemas as Record<string, unknown>;

      expect(schemas.ListAuditLogRequest).toBeDefined();
      expect(schemas.GenerateReportRequest).toBeDefined();
    });
  });

  describe('Components - Responses', () => {
    it('should have reusable error responses', () => {
      const components = openApiSpec.components as Record<string, unknown>;
      const responses = components.responses as Record<string, unknown>;

      expect(responses).toBeDefined();
      expect(responses.BadRequest).toBeDefined();
      expect(responses.NotFound).toBeDefined();
      expect(responses.Conflict).toBeDefined();
      expect(responses.InternalError).toBeDefined();
    });
  });

  describe('OpenAPI 3.1.0 Spec Serialization', () => {
    it('should be serializable to valid JSON', () => {
      const json = JSON.stringify(openApiSpec);
      expect(json).toBeDefined();
      expect(json.length).toBeGreaterThan(0);

      const parsed = JSON.parse(json);
      expect(parsed.openapi).toBe('3.1.0');
    });

    it('should have valid structure for OpenAPI 3.1.0', () => {
      // Required fields for OpenAPI 3.1.0
      expect(openApiSpec.openapi).toBeDefined();
      expect(openApiSpec.info).toBeDefined();

      // Info required fields
      const info = openApiSpec.info as Record<string, unknown>;
      expect(info.title).toBeDefined();
      expect(info.version).toBeDefined();
    });
  });
});

describe('Zod-to-JSON-Schema Converted Schemas', () => {
  it('should export openApiSchemas object', () => {
    expect(openApiSchemas).toBeDefined();
    expect(typeof openApiSchemas).toBe('object');
  });

  it('should have SubjectDN schema with correct structure', () => {
    const schema = openApiSchemas.SubjectDN as Record<string, unknown>;
    expect(schema).toBeDefined();
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();

    const props = schema.properties as Record<string, unknown>;
    expect(props.commonName).toBeDefined();
    expect(props.organization).toBeDefined();
    expect(props.country).toBeDefined();
  });

  it('should have CertificateStatus enum schema', () => {
    const schema = openApiSchemas.CertificateStatus as Record<string, unknown>;
    expect(schema).toBeDefined();
    expect(schema.type).toBe('string');
    expect(schema.enum).toBeDefined();
    expect(schema.enum).toContain('active');
    expect(schema.enum).toContain('revoked');
    expect(schema.enum).toContain('expired');
  });

  it('should have CertificateType enum schema', () => {
    const schema = openApiSchemas.CertificateType as Record<string, unknown>;
    expect(schema).toBeDefined();
    expect(schema.type).toBe('string');
    expect(schema.enum).toBeDefined();
    expect(schema.enum).toContain('server');
    expect(schema.enum).toContain('client');
    expect(schema.enum).toContain('email');
    expect(schema.enum).toContain('code_signing');
  });

  it('should have KeyAlgorithm enum schema', () => {
    const schema = openApiSchemas.KeyAlgorithm as Record<string, unknown>;
    expect(schema).toBeDefined();
    expect(schema.type).toBe('string');
    expect(schema.enum).toBeDefined();
    expect(schema.enum).toContain('RSA-2048');
    expect(schema.enum).toContain('RSA-4096');
  });

  it('should have RevocationReason enum schema', () => {
    const schema = openApiSchemas.RevocationReason as Record<string, unknown>;
    expect(schema).toBeDefined();
    expect(schema.type).toBe('string');
    expect(schema.enum).toBeDefined();
    expect(schema.enum).toContain('unspecified');
    expect(schema.enum).toContain('keyCompromise');
    expect(schema.enum).toContain('caCompromise');
  });

  it('should have CreateCaRequest schema with subject field', () => {
    const schema = openApiSchemas.CreateCaRequest as Record<string, unknown>;
    expect(schema).toBeDefined();
    expect(schema.type).toBe('object');

    const props = schema.properties as Record<string, unknown>;
    expect(props.subject).toBeDefined();
    expect(props.keyAlgorithm).toBeDefined();
    expect(props.validityYears).toBeDefined();
  });

  it('should have CreateCertificateRequest schema', () => {
    const schema = openApiSchemas.CreateCertificateRequest as Record<string, unknown>;
    expect(schema).toBeDefined();
    expect(schema.type).toBe('object');

    const props = schema.properties as Record<string, unknown>;
    expect(props.caId).toBeDefined();
    expect(props.subject).toBeDefined();
    expect(props.certificateType).toBeDefined();
    expect(props.validityDays).toBeDefined();
  });

  it('should have CertificateDetail schema with all fields', () => {
    const schema = openApiSchemas.CertificateDetail as Record<string, unknown>;
    expect(schema).toBeDefined();
    expect(schema.type).toBe('object');

    const props = schema.properties as Record<string, unknown>;
    expect(props.id).toBeDefined();
    expect(props.caId).toBeDefined();
    expect(props.serialNumber).toBeDefined();
    expect(props.certificateType).toBeDefined();
    expect(props.status).toBeDefined();
    expect(props.subjectDn).toBeDefined();
    expect(props.issuerDn).toBeDefined();
    expect(props.notBefore).toBeDefined();
    expect(props.notAfter).toBeDefined();
    expect(props.fingerprints).toBeDefined();
  });
});

describe('OpenAPI Configuration Options', () => {
  it('should have correct swagger options structure', () => {
    expect(swaggerOptions).toBeDefined();
    expect(swaggerOptions.openapi).toBeDefined();
    expect(swaggerOptions.openapi?.openapi).toBe('3.1.0');
  });

  it('should have all required components in swagger options', () => {
    const openapi = swaggerOptions.openapi;
    expect(openapi?.info).toBeDefined();
    expect(openapi?.servers).toBeDefined();
    expect(openapi?.tags).toBeDefined();
    expect(openapi?.components).toBeDefined();
    expect(openapi?.components?.schemas).toBeDefined();
    expect(openapi?.components?.responses).toBeDefined();
  });
});
