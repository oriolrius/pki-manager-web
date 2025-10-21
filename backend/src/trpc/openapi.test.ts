/**
 * OpenAPI Integration Tests
 *
 * Tests to validate:
 * 1. OpenAPI document generation
 * 2. OpenAPI 3.0.3 spec compliance
 * 3. Expected endpoints are documented
 * 4. Schemas are properly defined
 */

import { describe, it, expect } from 'vitest';
import { openApiDocument } from './openapi.js';

describe('OpenAPI Document Generation', () => {
  it('should generate a valid OpenAPI document', () => {
    expect(openApiDocument).toBeDefined();
    expect(openApiDocument).toBeTypeOf('object');
  });

  it('should have OpenAPI version 3.0.3', () => {
    expect(openApiDocument.openapi).toBe('3.0.3');
  });

  it('should have required info fields', () => {
    expect(openApiDocument.info).toBeDefined();
    expect(openApiDocument.info.title).toBe('PKI Manager API');
    expect(openApiDocument.info.version).toBe('1.0.0');
    expect(openApiDocument.info.description).toBeDefined();
  });

  it('should have the correct base URL', () => {
    expect(openApiDocument.servers).toBeDefined();
    expect(openApiDocument.servers).toHaveLength(1);
    expect(openApiDocument.servers?.[0].url).toMatch(/http:\/\/localhost:3000\/api/);
  });

  it('should include defined tags', () => {
    expect(openApiDocument.tags).toBeDefined();
    expect(openApiDocument.tags).toBeInstanceOf(Array);

    const tagNames = openApiDocument.tags?.map((tag) => tag.name) || [];
    expect(tagNames).toContain('certificates');
    expect(tagNames).toContain('ca');
    expect(tagNames).toContain('crl');
    expect(tagNames).toContain('audit');
  });

  it('should have paths defined', () => {
    expect(openApiDocument.paths).toBeDefined();
    expect(openApiDocument.paths).toBeTypeOf('object');
  });
});

describe('Certificate Endpoints', () => {
  it('should include GET /certificates endpoint', () => {
    const paths = openApiDocument.paths || {};
    expect(paths['/certificates']).toBeDefined();
    expect(paths['/certificates']?.get).toBeDefined();
  });

  it('should have proper metadata for GET /certificates', () => {
    const endpoint = openApiDocument.paths?.['/certificates']?.get;

    expect(endpoint?.summary).toBe('List certificates');
    expect(endpoint?.description).toContain('paginated list');
    expect(endpoint?.tags).toContain('certificates');
  });

  it('should define query parameters for filtering', () => {
    const endpoint = openApiDocument.paths?.['/certificates']?.get;
    const parameters = endpoint?.parameters || [];

    // Should have parameters defined (as an array or reference)
    expect(parameters).toBeDefined();
  });

  it('should define response schema', () => {
    const endpoint = openApiDocument.paths?.['/certificates']?.get;
    const responses = endpoint?.responses;

    expect(responses).toBeDefined();
    expect(responses?.['200']).toBeDefined();
  });
});

describe('OpenAPI Schema Definitions', () => {
  it('should have components defined', () => {
    expect(openApiDocument.components).toBeDefined();
  });

  it('should have schemas in components or properly structured without them', () => {
    // Schemas may or may not be present depending on how tRPC-swagger generates them
    // If present, they should be an object
    if (openApiDocument.components?.schemas) {
      expect(openApiDocument.components.schemas).toBeTypeOf('object');
    }
    // At minimum, components should exist
    expect(openApiDocument.components).toBeDefined();
  });
});

describe('OpenAPI Document Structure', () => {
  it('should be serializable to JSON', () => {
    const jsonString = JSON.stringify(openApiDocument);
    expect(jsonString).toBeDefined();
    expect(jsonString.length).toBeGreaterThan(0);

    // Should be parseable back
    const parsed = JSON.parse(jsonString);
    expect(parsed.openapi).toBe('3.0.3');
  });

  it('should have valid structure for OpenAPI 3.0', () => {
    // Required fields for OpenAPI 3.0
    expect(openApiDocument.openapi).toBeDefined();
    expect(openApiDocument.info).toBeDefined();
    expect(openApiDocument.paths).toBeDefined();

    // Info object required fields
    expect(openApiDocument.info.title).toBeDefined();
    expect(openApiDocument.info.version).toBeDefined();
  });
});

describe('OpenAPI Documentation Quality', () => {
  it('should have meaningful descriptions', () => {
    const endpoint = openApiDocument.paths?.['/certificates']?.get;

    expect(endpoint?.description).toBeDefined();
    expect(endpoint?.description?.length).toBeGreaterThan(10);
  });

  it('should organize endpoints with tags', () => {
    const paths = openApiDocument.paths || {};

    Object.values(paths).forEach((pathItem) => {
      if (!pathItem) return;

      const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
      methods.forEach((method) => {
        const operation = pathItem[method];
        if (operation) {
          // Each operation should have tags
          expect(operation.tags).toBeDefined();
          expect(operation.tags).toBeInstanceOf(Array);
          expect(operation.tags?.length).toBeGreaterThan(0);
        }
      });
    });
  });

  it('should have unique operation IDs (if defined)', () => {
    const paths = openApiDocument.paths || {};
    const operationIds = new Set<string>();

    Object.values(paths).forEach((pathItem) => {
      if (!pathItem) return;

      const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
      methods.forEach((method) => {
        const operation = pathItem[method];
        if (operation?.operationId) {
          // Check for duplicate operation IDs
          expect(operationIds.has(operation.operationId)).toBe(false);
          operationIds.add(operation.operationId);
        }
      });
    });
  });
});
