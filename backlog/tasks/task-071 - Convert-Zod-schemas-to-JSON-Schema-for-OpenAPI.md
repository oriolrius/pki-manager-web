---
id: task-071
title: Convert Zod schemas to JSON Schema for OpenAPI
status: Done
assignee:
  - '@myself'
created_date: '2025-11-27 15:35'
updated_date: '2025-11-27 16:33'
labels:
  - openapi
  - backend
  - schemas
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create JSON Schema versions of existing Zod validation schemas for use in OpenAPI documentation.

Use zod-to-json-schema library to convert schemas while maintaining validation consistency.

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zod-to-json-schema package installed
- [x] #2 backend/src/rest/schemas/openapi-schemas.ts created
- [x] #3 All request/response schemas converted to JSON Schema
- [x] #4 Schema references properly linked in OpenAPI spec

- [x] #5 All existing tests pass after schema conversion
- [x] #6 Test results captured in implementation notes showing all tests pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### Package Installed
- `zod-to-json-schema@3.25.0`

### Files Created
- `backend/src/rest/schemas/openapi-schemas.ts` - JSON Schema conversions from Zod schemas

### Files Modified
- `backend/src/rest/openapi.ts` - Updated to import and use converted schemas

### Schemas Converted

**Common/Enum Schemas:**
- `SubjectDN` (Distinguished Name)
- `CertificateStatus` (active, revoked, expired)
- `CertificateType` (server, client, email, code_signing)
- `KeyAlgorithm` (RSA-2048, RSA-4096)
- `RevocationReason` (8 reasons)

**CA Request Schemas:**
- `CreateCaRequest`
- `ListCasRequest`
- `RevokeCaRequest`
- `DeleteCaRequest`

**Certificate Request Schemas:**
- `CreateCertificateRequest`
- `ListCertificatesRequest`
- `RenewCertificateRequest`
- `RevokeCertificateRequest`
- `DeleteCertificateRequest`
- `DownloadCertificateRequest`
- `CertificateDetail`

**Bulk Operation Schemas:**
- `BulkCreateCertificatesRequest`
- `BulkRevokeCertificatesRequest`
- `BulkRenewCertificatesRequest`
- `BulkDeleteCertificatesRequest`
- `BulkDownloadCertificatesRequest`

**CRL Schemas:**
- `GenerateCrlRequest`
- `GetCrlRequest`
- `ListCrlsRequest`

**Audit Schemas:**
- `ListAuditLogRequest`
- `GenerateReportRequest`

### Implementation Details

The `zod-to-json-schema` library is used with the following configuration:
- `$refStrategy: 'none'` - Inlines all definitions for OpenAPI compatibility
- `target: 'openApi3'` - Generates OpenAPI 3.x compatible schemas

Manual schemas retained (not converted from Zod):
- `Error` - API error response format
- `Pagination` - List response pagination wrapper

### Test Results (2025-11-27 17:32 UTC)

```
$ pnpm test

> @pki-manager/backend@1.1.2 test /home/oriol/miimetiq3/pki-manager/backend
> vitest run

 RUN  v2.1.9 /home/oriol/miimetiq3/pki-manager/backend

 ✓ src/lib/audit.test.ts (8 tests) 6ms
 ✓ src/trpc/openapi.test.ts (17 tests) 7ms
 ✓ src/trpc/procedures/audit.test.ts (10 tests) 29ms
 ✓ src/server.test.ts (17 tests) 40ms
 ✓ src/crypto/crypto.test.ts (30 tests | 1 skipped) 584ms
 ✓ src/server.crl-endpoint.test.ts (13 tests) 349ms
 ✓ src/trpc/procedures/certificate-bulk.test.ts (8 tests) 635ms
 ✓ src/trpc/procedures/ca-create.test.ts (1 test) 719ms
 ✓ src/trpc/procedures/ca.test.ts (21 tests) 4681ms
 ✓ src/trpc/procedures/certificate.test.ts (20 tests) 10542ms

 Test Files  10 passed (10)
      Tests  144 passed | 1 skipped (145)
   Start at  17:32:59
   Duration  11.36s
```

All tests pass confirming schema conversion maintains backward compatibility.
<!-- SECTION:NOTES:END -->
