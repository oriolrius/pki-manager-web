# OpenAPI Integration - Test Coverage

## Test Summary

✅ **34 tests total - All passing**
- 17 tests for OpenAPI document generation
- 17 tests for server endpoints

## Test Files

### 1. `src/trpc/openapi.test.ts` - OpenAPI Document Generation Tests

Tests the generated OpenAPI specification document for compliance and completeness.

**Test Suites:**
- **OpenAPI Document Generation** (6 tests)
  - Validates document structure
  - Verifies OpenAPI version 3.0.3
  - Checks required info fields
  - Validates base URL configuration
  - Confirms tag definitions
  - Ensures paths are defined

- **Certificate Endpoints** (4 tests)
  - Verifies GET /certificates endpoint exists
  - Validates endpoint metadata (summary, description, tags)
  - Checks query parameter definitions
  - Validates response schema

- **OpenAPI Schema Definitions** (2 tests)
  - Confirms components are defined
  - Validates schema structure

- **OpenAPI Document Structure** (2 tests)
  - Tests JSON serializability
  - Validates OpenAPI 3.0 compliance

- **OpenAPI Documentation Quality** (3 tests)
  - Checks for meaningful descriptions
  - Validates tag organization
  - Ensures unique operation IDs

### 2. `src/server.test.ts` - Server Integration Tests

Tests the actual HTTP endpoints that serve OpenAPI documentation.

**Test Suites:**
- **OpenAPI Specification Endpoint** (6 tests)
  - GET /api/openapi.json returns 200
  - Returns proper JSON content-type
  - Returns valid parseable JSON
  - Contains OpenAPI 3.0.3 spec
  - Includes certificate endpoints
  - Has proper API metadata

- **Swagger UI Endpoint** (4 tests)
  - GET /api/docs returns 200
  - Returns HTML content-type
  - Contains swagger-ui div element
  - Has expected HTML structure

- **Health Check Endpoint** (1 test)
  - Validates /health endpoint functionality

- **Error Handling** (2 tests)
  - Returns 404 for non-existent Swagger UI files
  - Prevents path traversal attacks

- **OpenAPI Spec Content Validation** (4 tests)
  - Validates server URLs
  - Checks required OpenAPI 3.0 fields
  - Validates path structure
  - Confirms certificate listing endpoint details

## Running the Tests

```bash
# Run all OpenAPI tests
npm test -- openapi.test.ts server.test.ts

# Run just document generation tests
npm test -- openapi.test.ts

# Run just server integration tests
npm test -- server.test.ts

# Run all tests in watch mode
npm run test:watch
```

## Test Coverage Areas

### ✅ Covered
- OpenAPI 3.0.3 specification generation
- OpenAPI document structure validation
- Endpoint accessibility (spec and docs)
- Content-type headers
- JSON parsing and validity
- Security (path traversal prevention)
- Certificate listing endpoint documentation
- Metadata completeness (title, version, description)
- Tag organization
- Server URL configuration

### 🔄 Future Coverage
As more endpoints get OpenAPI metadata, add tests for:
- Additional certificate operations (create, update, delete)
- CA operations
- CRL operations
- Audit log operations
- Parameter validation in OpenAPI spec
- Response schema completeness
- Security scheme definitions (when auth is added)

## CI/CD Integration

These tests run automatically on:
```bash
npm test
```

Recommended to run before:
- Creating pull requests
- Deploying to staging/production
- Making changes to tRPC procedures with OpenAPI metadata

## Maintenance

When adding new OpenAPI endpoints:
1. Add `.meta()` with OpenAPI config to the tRPC procedure
2. Add `.output()` with Zod schema (required for OpenAPI)
3. The endpoint will automatically appear in the OpenAPI spec
4. Consider adding specific tests for the new endpoint

## Benefits

✅ **Quality Assurance** - Ensures OpenAPI spec is always valid
✅ **Regression Prevention** - Catches breaking changes
✅ **Documentation Validation** - Confirms docs are accessible
✅ **Security Testing** - Validates error handling and security
✅ **Continuous Validation** - Runs on every test execution
