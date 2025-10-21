# OpenAPI 3.0.3 Integration Documentation

**Document ID:** doc-004
**Created:** 2025-10-21
**Status:** Active
**Related Tasks:** task-013

## Overview

The PKI Manager API provides comprehensive OpenAPI 3.0.3 documentation, enabling developers to explore the API through an interactive Swagger UI interface and integrate with any OpenAPI-compatible tools. This integration bridges tRPC's type-safe procedures with standard REST API documentation.

## Key Features

✅ **Auto-generated** - Documentation generated directly from tRPC schemas
✅ **Type-safe** - Uses Zod schemas ensuring consistency between code and docs
✅ **Interactive** - Swagger UI for testing endpoints in the browser
✅ **Standards-compliant** - OpenAPI 3.0.3 specification
✅ **Always in sync** - Documentation updates automatically with code changes

## Access Points

### Swagger UI (Interactive Documentation)

**URL**: `http://localhost:3000/api/docs`

Interactive web interface featuring:
- Browsable API endpoints organized by tags
- Try-it-out functionality for testing endpoints
- Request/response schema visualization
- Example values and descriptions
- Download OpenAPI spec option

### OpenAPI Specification (JSON)

**URL**: `http://localhost:3000/api/openapi.json`

Machine-readable OpenAPI 3.0.3 specification in JSON format.

**Use Cases:**
- Import into Postman, Insomnia, or other API clients
- Generate client SDKs in various languages
- Validate API contracts
- Integrate with API gateways
- Documentation generation tools

## Implementation Architecture

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| OpenAPI Generator | trpc-swagger v2.0.0 | Generates OpenAPI 3.0.3 from tRPC routers |
| tRPC Framework | @trpc/server v11 | Type-safe API procedures |
| Schema Validation | Zod | Input/output validation and type generation |
| UI Framework | swagger-ui-dist | Interactive documentation interface |
| Web Server | Fastify | HTTP server for endpoints |

### Architecture Components

```
┌─────────────────────────────────────────────────────────────┐
│                     tRPC Procedures                          │
│  (Type-safe procedures with Zod schemas and OpenAPI meta)   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  trpc-swagger Generator                      │
│         (Converts tRPC + metadata → OpenAPI 3.0.3)           │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
┌──────────────────┐          ┌──────────────────┐
│  OpenAPI JSON    │          │   Swagger UI     │
│  /api/openapi.json│         │   /api/docs      │
└──────────────────┘          └──────────────────┘
```

## Configuration

### OpenAPI Document Configuration

**File**: `backend/src/trpc/openapi.ts`

```typescript
export const openApiDocument = generateOpenApiDocument(appRouter, {
  title: 'PKI Manager API',
  version: '1.0.0',
  baseUrl: 'http://localhost:3000/api',
  description: 'Public Key Infrastructure (PKI) Management System API',
  tags: [
    {
      name: 'certificates',
      description: 'Certificate operations',
    },
    {
      name: 'ca',
      description: 'Certificate Authority operations',
    },
    {
      name: 'crl',
      description: 'Certificate Revocation List operations',
    },
    {
      name: 'audit',
      description: 'Audit log operations',
    },
  ],
  docsUrl: 'https://github.com/your-org/pki-manager',
});
```

### tRPC Initialization with OpenAPI Support

**File**: `backend/src/trpc/init.ts`

```typescript
import { initTRPC } from '@trpc/server';
import type { OpenApiMeta } from 'trpc-swagger';

const t = initTRPC.context<Context>().meta<OpenApiMeta>().create({
  // ... error formatting
});
```

## Adding OpenAPI Documentation to Procedures

### Requirements for OpenAPI-Enabled Procedures

1. **OpenAPI Metadata** - `.meta()` with OpenAPI configuration
2. **Input Schema** - `.input()` with Zod schema
3. **Output Schema** - `.output()` with Zod schema (required by trpc-swagger)

### Example: Documented Procedure

```typescript
import { z } from 'zod';

export const certificateRouter = router({
  list: publicProcedure
    .meta({
      openapi: {
        method: 'GET',                    // HTTP method
        path: '/certificates',            // REST endpoint path
        tags: ['certificates'],           // Grouping tag
        summary: 'List certificates',     // Short description
        description: 'Retrieve a paginated list of certificates...', // Detailed description
      },
    })
    .input(listCertificatesSchema)        // Input validation schema
    .output(certificateListOutputSchema)  // Output schema (required!)
    .query(async ({ ctx, input }) => {
      // Implementation
    }),
});
```

### OpenAPI Metadata Fields

| Field | Required | Description |
|-------|----------|-------------|
| `method` | Yes | HTTP method: GET, POST, PUT, DELETE, PATCH |
| `path` | Yes | REST endpoint path (must start with /) |
| `tags` | No | Array of tags for grouping endpoints |
| `summary` | No | Short description (shown in lists) |
| `description` | No | Detailed description (shown in endpoint detail) |
| `protect` | No | Whether endpoint requires authentication |

### Output Schema Requirement

**Critical**: trpc-swagger requires an explicit `.output()` schema for OpenAPI generation:

```typescript
// ❌ Wrong - Will fail OpenAPI generation
.query(async () => {
  return { items: [], totalCount: 0 };
})

// ✅ Correct - Explicit output schema
.output(z.object({
  items: z.array(z.object({ /* ... */ })),
  totalCount: z.number()
}))
.query(async () => {
  return { items: [], totalCount: 0 };
})
```

## Server Endpoints

### 1. OpenAPI Specification Endpoint

**Endpoint**: `GET /api/openapi.json`
**Content-Type**: `application/json`
**Description**: Returns the complete OpenAPI 3.0.3 specification

**Response Structure**:
```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "PKI Manager API",
    "version": "1.0.0",
    "description": "..."
  },
  "servers": [{ "url": "http://localhost:3000/api" }],
  "tags": [...],
  "paths": {
    "/certificates": {
      "get": { /* endpoint definition */ }
    }
  },
  "components": { /* schemas, if generated */ }
}
```

### 2. Swagger UI Endpoint

**Endpoint**: `GET /api/docs`
**Content-Type**: `text/html`
**Description**: Interactive API documentation interface

**Features**:
- Browse all available endpoints
- View request/response schemas
- Test endpoints directly from browser
- Download OpenAPI spec
- Search functionality

### 3. Swagger UI Static Assets

**Endpoint**: `GET /api/docs/:file`
**Description**: Serves Swagger UI static files (CSS, JS, images)

**Security**:
- Path traversal protection
- Only serves files from swagger-ui-dist package
- Returns 404 for non-existent or unauthorized files

## Testing

### Test Coverage

**Total Tests**: 34 (all passing)

**Test Files**:
1. `backend/src/trpc/openapi.test.ts` (17 tests)
   - OpenAPI document generation validation
   - Specification compliance (OpenAPI 3.0.3)
   - Endpoint documentation completeness
   - Schema structure validation
   - Documentation quality checks

2. `backend/src/server.test.ts` (17 tests)
   - HTTP endpoint accessibility
   - Content-type validation
   - JSON parsing and validity
   - Swagger UI HTML structure
   - Security (path traversal prevention)
   - Error handling

### Running Tests

```bash
# All OpenAPI tests
npm test -- openapi.test.ts server.test.ts

# Document generation tests only
npm test -- openapi.test.ts

# Server integration tests only
npm test -- server.test.ts

# Watch mode
npm run test:watch
```

### Test Documentation

Detailed test coverage documentation: `backend/OPENAPI_TESTING.md`

## Usage Examples

### Importing into Postman

1. Open Postman
2. Click "Import"
3. Select "Link" tab
4. Enter: `http://localhost:3000/api/openapi.json`
5. Click "Continue" → "Import"

### Generating Client SDKs

```bash
# Install OpenAPI Generator
npm install -g @openapitools/openapi-generator-cli

# Generate TypeScript client
openapi-generator-cli generate \
  -i http://localhost:3000/api/openapi.json \
  -g typescript-fetch \
  -o ./generated-client

# Generate Python client
openapi-generator-cli generate \
  -i http://localhost:3000/api/openapi.json \
  -g python \
  -o ./python-client
```

### Using with API Testing Tools

**HTTPie**:
```bash
http GET localhost:3000/api/certificates certificateType==server status==active
```

**cURL**:
```bash
curl "http://localhost:3000/api/certificates?certificateType=server&status=active"
```

## Current OpenAPI-Enabled Endpoints

### Certificate Operations

| Endpoint | Method | Description | Status |
|----------|--------|-------------|--------|
| `/certificates` | GET | List certificates with filtering/searching | ✅ Implemented |

### Future Endpoints

The following endpoints will be added as they are implemented:

- **Certificates**: GET /:id, POST /, PUT /:id/renew, DELETE /:id, POST /:id/revoke
- **Certificate Authorities**: GET /cas, POST /cas, GET /cas/:id
- **CRLs**: GET /crls, POST /crls/generate
- **Audit Logs**: GET /audit

## Best Practices

### 1. Always Include Output Schemas

```typescript
// Define reusable output schemas
const certificateOutputSchema = z.object({
  id: z.string(),
  // ... all fields
});

// Use in procedure
.output(certificateOutputSchema)
```

### 2. Use Descriptive Summaries and Descriptions

```typescript
.meta({
  openapi: {
    summary: 'List certificates',  // Short, action-oriented
    description: 'Retrieve a paginated list of certificates with optional filtering by status, type, domain, and expiry. Supports searching across CN, subject, and SANs. Results are paginated and sortable.',  // Detailed, informative
  }
})
```

### 3. Organize with Tags

```typescript
.meta({
  openapi: {
    tags: ['certificates'],  // Groups related endpoints
  }
})
```

### 4. Use Proper HTTP Methods

- **GET** - Retrieve data (queries)
- **POST** - Create resources (mutations)
- **PUT/PATCH** - Update resources (mutations)
- **DELETE** - Delete resources (mutations)

### 5. Keep OpenAPI Config in Sync

When modifying API:
1. Update the procedure code
2. Update `.meta()` if endpoint changes
3. Update `.output()` if response changes
4. Run tests to validate

## Troubleshooting

### Issue: "Output parser expects a Zod validator"

**Cause**: Missing `.output()` schema on procedure with OpenAPI metadata

**Solution**: Add explicit output schema:
```typescript
.output(z.object({ /* response schema */ }))
```

### Issue: Swagger UI not loading

**Check**:
1. Server is running
2. Navigate to `http://localhost:3000/api/docs`
3. Check browser console for errors
4. Verify `/api/openapi.json` is accessible

### Issue: OpenAPI spec missing endpoints

**Check**:
1. Procedure has `.meta({ openapi: { ... } })`
2. Procedure has both `.input()` and `.output()`
3. Schemas use Zod (not other validators)

## Performance Considerations

### OpenAPI Document Generation

- Generated **once at startup** (not on every request)
- Cached in memory
- No performance impact on endpoint calls
- Spec regenerates on server restart

### Swagger UI Loading

- Static assets served efficiently
- First load may be slower (downloads JS/CSS)
- Subsequent loads cached by browser

## Security Considerations

### Current State

- All endpoints are public (no authentication yet)
- Path traversal protection for static file serving
- CORS configured for frontend access

### Future Enhancements

- Add authentication schemes to OpenAPI spec
- Document security requirements per endpoint
- API key support
- OAuth2 flows documentation

## Related Documentation

- **Certificate Listing API**: doc-003
- **Certificate Issuance API**: doc-002
- **Product Requirements**: doc-001
- **Testing Guide**: `backend/OPENAPI_TESTING.md`
- **Usage Guide**: `backend/OPENAPI.md`

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2025-10-21 | 1.0 | Initial OpenAPI 3.0.3 integration with Swagger UI |

## References

- **trpc-swagger Documentation**: https://github.com/Vercjames/package-trpc-swagger
- **OpenAPI Specification 3.0.3**: https://spec.openapis.org/oas/v3.0.3
- **Swagger UI**: https://swagger.io/tools/swagger-ui/
- **Zod Schema Validation**: https://zod.dev/
