---
id: doc-005
title: OpenAPI Specification Design for PKI Manager REST API
type: other
created_date: '2025-11-27 15:34'
---
# OpenAPI Specification Design for PKI Manager REST API

## Status
**Proposed** | Date: 2025-11-27

## Context

The PKI Manager currently uses tRPC for type-safe API communication between the React frontend and Fastify backend. While tRPC provides excellent developer experience and type safety within the TypeScript ecosystem, there is a need to expose the API via a standard REST interface with OpenAPI documentation for:

1. **External integrations** - Third-party systems and automation tools
2. **Non-TypeScript clients** - Python scripts, shell scripts, other language SDKs
3. **API documentation** - Self-documenting API for developers
4. **Testing** - Standardized API testing with tools like Postman, curl, and automated integration tests
5. **Compliance** - Industry-standard API specification for audits

## Decision

Implement an OpenAPI 3.1 specification alongside the existing tRPC implementation using a **parallel REST layer** approach. The REST endpoints will be served by Fastify alongside the tRPC routes, sharing the same business logic and validation schemas.

### Architecture Approach

```
┌─────────────────────────────────────────────────────────────┐
│                     Fastify Server                          │
├─────────────────────────────────────────────────────────────┤
│  /trpc/*           │  /api/v1/*                             │
│  (tRPC adapter)    │  (REST endpoints)                      │
├─────────────────────────────────────────────────────────────┤
│                 Shared Business Logic                       │
│         (services/, db/, kms integration)                   │
└─────────────────────────────────────────────────────────────┘
```

### OpenAPI Endpoint Design

#### Base URL
```
/api/v1
```

#### Resources and Endpoints

##### Certificate Authorities (CAs)

| Method | Endpoint | tRPC Equivalent | Description |
|--------|----------|-----------------|-------------|
| GET | `/cas` | ca.list | List all CAs with filtering |
| POST | `/cas` | ca.create | Create a new CA |
| GET | `/cas/{id}` | ca.getById | Get CA details |
| POST | `/cas/{id}/revoke` | ca.revoke | Revoke a CA |
| DELETE | `/cas/{id}` | ca.delete | Delete a CA |
| GET | `/cas/{id}/certificates` | certificate.list (filtered) | List certificates issued by CA |
| GET | `/cas/{id}/crls` | crl.list | List CRLs for CA |
| POST | `/cas/{id}/crls` | crl.generate | Generate new CRL |

##### Certificates

| Method | Endpoint | tRPC Equivalent | Description |
|--------|----------|-----------------|-------------|
| GET | `/certificates` | certificate.list | List all certificates |
| POST | `/certificates` | certificate.issue | Issue a new certificate |
| GET | `/certificates/{id}` | certificate.getById | Get certificate details |
| POST | `/certificates/{id}/renew` | certificate.renew | Renew a certificate |
| POST | `/certificates/{id}/revoke` | certificate.revoke | Revoke a certificate |
| DELETE | `/certificates/{id}` | certificate.delete | Delete a certificate |
| GET | `/certificates/{id}/download` | certificate.download | Download certificate |

##### Bulk Operations

| Method | Endpoint | tRPC Equivalent | Description |
|--------|----------|-----------------|-------------|
| POST | `/certificates/bulk/issue` | certificate.bulkIssue | Bulk issue from CSV |
| POST | `/certificates/bulk/revoke` | certificate.bulkRevoke | Bulk revoke certificates |
| POST | `/certificates/bulk/renew` | certificate.bulkRenew | Bulk renew certificates |
| DELETE | `/certificates/bulk` | certificate.bulkDelete | Bulk delete certificates |
| POST | `/certificates/bulk/download` | certificate.bulkDownload | Bulk download certificates |

##### CRLs

| Method | Endpoint | tRPC Equivalent | Description |
|--------|----------|-----------------|-------------|
| GET | `/crls/{id}` | crl.getLatest (by id) | Get CRL by ID |

##### Search & Discovery

| Method | Endpoint | tRPC Equivalent | Description |
|--------|----------|-----------------|-------------|
| GET | `/search` | search.global | Global search |
| GET | `/domains` | domain.list | List domains |

##### Dashboard & Reports

| Method | Endpoint | tRPC Equivalent | Description |
|--------|----------|-----------------|-------------|
| GET | `/dashboard/stats` | dashboard.stats | Dashboard statistics |
| GET | `/dashboard/expiring` | dashboard.expiringSoon | Expiring items |
| GET | `/audit` | audit.list | Audit log entries |
| POST | `/reports` | audit.generateReport | Generate report |

### Request/Response Standards

#### Pagination
```json
{
  "items": [...],
  "pagination": {
    "total": 100,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

#### Error Responses
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      { "field": "subject.country", "message": "Must be exactly 2 characters" }
    ]
  }
}
```

#### Query Parameters for Filtering
- `status` - Filter by status (active, revoked, expired)
- `type` - Filter by certificate type
- `caId` - Filter by issuing CA
- `search` - Text search
- `sortBy` - Sort field
- `sortOrder` - asc/desc
- `limit` - Page size (1-100)
- `offset` - Page offset

### Authentication & Authorization

Initially, the REST API will use the same authentication mechanism as the tRPC endpoints. Future considerations:
- API key authentication for machine-to-machine
- OAuth2/OIDC integration via Keycloak

### Implementation Strategy

1. **Phase 1: Core Infrastructure**
   - Install `@fastify/swagger` and `@fastify/swagger-ui`
   - Configure OpenAPI 3.1 specification
   - Set up REST route registration pattern
   - Create shared service layer extraction

2. **Phase 2: Resource Endpoints**
   - Implement CA REST endpoints
   - Implement Certificate REST endpoints
   - Implement CRL REST endpoints

3. **Phase 3: Bulk & Utility Endpoints**
   - Implement bulk operations
   - Implement search/discovery endpoints
   - Implement dashboard/audit endpoints

4. **Phase 4: Testing & Documentation**
   - Write integration tests for all endpoints
   - Generate OpenAPI specification
   - Set up Swagger UI at `/api/docs`

### Technology Choices

- **@fastify/swagger** - OpenAPI schema generation from Fastify routes
- **@fastify/swagger-ui** - Interactive API documentation UI
- **zod-to-json-schema** - Convert existing Zod schemas to JSON Schema for OpenAPI
- **supertest** - HTTP integration testing

### File Structure

```
backend/src/
├── rest/
│   ├── index.ts              # REST plugin registration
│   ├── openapi.ts            # OpenAPI configuration
│   ├── routes/
│   │   ├── ca.routes.ts      # CA REST routes
│   │   ├── certificate.routes.ts
│   │   ├── crl.routes.ts
│   │   ├── bulk.routes.ts
│   │   ├── search.routes.ts
│   │   └── audit.routes.ts
│   └── schemas/
│       └── openapi-schemas.ts # JSON Schema versions of Zod schemas
├── services/                  # Shared business logic (extracted from procedures)
│   ├── ca.service.ts
│   ├── certificate.service.ts
│   └── crl.service.ts
└── tests/
    └── rest/
        ├── ca.test.ts
        ├── certificate.test.ts
        └── bulk.test.ts
```

## Integration Test Design

### Test Categories

1. **CRUD Operations**
   - Create, read, update, delete for each resource
   - Validation error handling
   - Not found error handling

2. **Business Logic**
   - CA revocation cascade
   - Certificate renewal chain
   - Validity period enforcement
   - Type-specific validations

3. **Bulk Operations**
   - CSV parsing and validation
   - Partial success handling
   - Large batch processing

4. **Download Formats**
   - All 14+ download formats
   - Password-protected formats
   - Chain building

### Test Structure

```typescript
describe('CA REST API', () => {
  describe('POST /api/v1/cas', () => {
    it('creates a CA with valid input')
    it('validates required fields')
    it('validates country code length')
    it('validates validity years range')
  })

  describe('GET /api/v1/cas', () => {
    it('lists CAs with pagination')
    it('filters by status')
    it('searches by subject')
    it('sorts by specified field')
  })

  describe('POST /api/v1/cas/{id}/revoke', () => {
    it('revokes CA and cascades to certificates')
    it('generates CRL on revocation')
    it('rejects already revoked CA')
  })
})
```

## Consequences

### Positive
- Industry-standard API documentation
- Enables non-TypeScript integrations
- Better testing infrastructure
- Self-documenting API
- Future-proof for external consumers

### Negative
- Additional code to maintain (REST routes alongside tRPC)
- Need to keep REST and tRPC in sync
- Increased surface area for bugs

### Mitigations
- Extract shared business logic to services
- Use Zod schemas for both REST and tRPC validation
- Comprehensive integration tests ensure parity

## References

- [OpenAPI 3.1 Specification](https://spec.openapis.org/oas/v3.1.0)
- [Fastify Swagger Plugin](https://github.com/fastify/fastify-swagger)
- [zod-to-json-schema](https://github.com/StefanTerdell/zod-to-json-schema)
