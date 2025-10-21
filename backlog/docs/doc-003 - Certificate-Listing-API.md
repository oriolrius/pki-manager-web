# Certificate Listing API Documentation

**Document ID:** doc-003
**Created:** 2025-10-21
**Status:** Active
**Related Tasks:** task-013

## Overview

The Certificate Listing API provides comprehensive functionality for retrieving certificates with advanced filtering, searching, sorting, and pagination capabilities. This endpoint is essential for certificate management dashboards and administrative interfaces.

## Endpoint

### List Certificates

**tRPC Procedure:** `certificate.list`
**REST Endpoint:** `GET /api/certificates`
**Authentication:** Public (to be restricted in future tasks)

## Request Parameters

All parameters are optional and can be combined for powerful querying.

### Filtering Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `caId` | string | Filter certificates by Certificate Authority ID |
| `status` | enum | Filter by certificate status: `active`, `expired`, `revoked` |
| `certificateType` | enum | Filter by type: `server`, `client`, `code_signing`, `email` |
| `domain` | string | Search for domain in Common Name (CN) or Subject Alternative Names (SANs) |
| `expiryStatus` | enum | Filter by computed expiry status: `active`, `expired`, `expiring_soon` (within 30 days) |

### Date Range Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `issuedAfter` | date | Only certificates issued after this date (notBefore >= date) |
| `issuedBefore` | date | Only certificates issued before this date (notBefore <= date) |
| `expiresAfter` | date | Only certificates expiring after this date (notAfter >= date) |
| `expiresBefore` | date | Only certificates expiring before this date (notAfter <= date) |

### Search

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Global text search across CN, subject DN, serial number, and all SAN types (DNS, IP, Email) |

### Sorting

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sortBy` | enum | `createdAt` | Field to sort by: `serialNumber`, `subjectDn`, `notBefore`, `notAfter`, `certificateType`, `status`, `createdAt` |
| `sortOrder` | enum | `desc` | Sort direction: `asc` or `desc` |

### Pagination

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `limit` | number | 50 | 1-100 | Number of results per page |
| `offset` | number | 0 | 0+ | Number of results to skip |

## Response

### Response Schema

```typescript
{
  items: Array<{
    id: string;
    caId: string;
    subjectDn: string;
    serialNumber: string;
    certificateType: 'server' | 'client' | 'code_signing' | 'email';
    notBefore: Date;
    notAfter: Date;
    certificatePem: string;
    kmsKeyId: string | null;
    status: 'active' | 'revoked' | 'expired';
    revocationDate: Date | null;
    revocationReason: string | null;
    sanDns: string[] | null;
    sanIp: string[] | null;
    sanEmail: string[] | null;
    renewedFromId: string | null;
    createdAt: Date;
    updatedAt: Date;
    expiryStatus: 'active' | 'expired' | 'expiring_soon';
  }>;
  totalCount: number;
  limit: number;
  offset: number;
}
```

### Response Fields

#### Certificate Fields

- **id** - Unique certificate identifier (UUID)
- **caId** - ID of the issuing Certificate Authority
- **subjectDn** - Distinguished Name of the certificate subject (e.g., "CN=example.com,O=Example Corp,C=US")
- **serialNumber** - Certificate serial number (hex string)
- **certificateType** - Purpose/type of the certificate
- **notBefore** - Certificate validity start date
- **notAfter** - Certificate validity end date
- **certificatePem** - Full certificate in PEM format
- **kmsKeyId** - KMS key ID for the certificate's private key (null for certificates without stored private keys)
- **status** - Current certificate status (manually set or system-updated)
- **revocationDate** - Date when certificate was revoked (null if not revoked)
- **revocationReason** - Reason for revocation (null if not revoked)
- **sanDns** - Subject Alternative Names - DNS entries
- **sanIp** - Subject Alternative Names - IP addresses
- **sanEmail** - Subject Alternative Names - Email addresses
- **renewedFromId** - ID of the certificate this one renewed (null if not a renewal)
- **createdAt** - Timestamp when certificate record was created
- **updatedAt** - Timestamp when certificate record was last updated
- **expiryStatus** - Computed expiry status based on current date and notAfter

#### Pagination Fields

- **totalCount** - Total number of certificates matching the filters (useful for pagination UI)
- **limit** - Number of results returned in this response
- **offset** - Number of results skipped

## Expiry Status Computation

The `expiryStatus` field is computed dynamically for each certificate:

- **active** - Certificate expires more than 30 days from now
- **expiring_soon** - Certificate expires within the next 30 days but hasn't expired yet
- **expired** - Certificate has already expired (notAfter < current date)

## Usage Examples

### Example 1: List All Active Server Certificates

```typescript
// tRPC client
const result = await trpc.certificate.list.query({
  certificateType: 'server',
  status: 'active',
  sortBy: 'notAfter',
  sortOrder: 'asc',
  limit: 50,
  offset: 0
});
```

```bash
# REST API
curl "http://localhost:3000/api/certificates?certificateType=server&status=active&sortBy=notAfter&sortOrder=asc&limit=50"
```

### Example 2: Find Certificates Expiring Soon

```typescript
const result = await trpc.certificate.list.query({
  expiryStatus: 'expiring_soon',
  sortBy: 'notAfter',
  sortOrder: 'asc'
});
```

### Example 3: Search for Domain

```typescript
const result = await trpc.certificate.list.query({
  domain: 'example.com'
});
```

### Example 4: Complex Query with Multiple Filters

```typescript
const result = await trpc.certificate.list.query({
  caId: 'ca-uuid-here',
  certificateType: 'server',
  status: 'active',
  issuedAfter: new Date('2024-01-01'),
  expiresAfter: new Date(),
  sortBy: 'createdAt',
  sortOrder: 'desc',
  limit: 20,
  offset: 0
});
```

### Example 5: Global Search

```typescript
const result = await trpc.certificate.list.query({
  search: 'myapp.example.com'
});
```

This searches across:
- Common Name in subject DN
- Full subject DN string
- Serial number
- All SAN DNS entries
- All SAN IP entries
- All SAN email entries

## Performance Considerations

### Indexes

The following database indexes optimize query performance:

- `idx_certificates_ca_id` - Fast filtering by CA
- `idx_certificates_status` - Fast filtering by status
- `idx_certificates_type` - Fast filtering by certificate type
- `idx_certificates_serial` - Fast serial number lookups

### Query Optimization

- **Limit Results**: Always use pagination (`limit` and `offset`) for large result sets
- **Specific Filters**: Use specific filters (caId, status, type) before expensive text searches
- **Avoid Wildcards**: The `search` parameter uses LIKE queries which can be slower on large datasets
- **Index-Friendly Sorts**: Sorting by indexed fields (status, type, caId) is faster

### Recommended Limits

- Default limit: 50 certificates
- Maximum limit: 100 certificates
- For large datasets, use specific filters to reduce result set size

## Error Handling

### Validation Errors

Invalid parameters return a `BAD_REQUEST` error with details:

```typescript
{
  code: 'BAD_REQUEST',
  message: 'Validation error',
  data: {
    zodError: { /* validation details */ }
  }
}
```

### Common Validation Errors

- `limit` must be between 1 and 100
- `offset` must be 0 or greater
- Dates must be valid ISO 8601 date strings
- Enum values must match allowed values

## Implementation Details

### Technology Stack

- **ORM**: Drizzle ORM for type-safe database queries
- **Validation**: Zod schemas for input/output validation
- **Database**: SQLite with indexed columns
- **Query Builder**: Dynamic query building with conditional filters

### Source Code References

- Schema Definition: `backend/src/trpc/schemas.ts:96-130`
- Procedure Implementation: `backend/src/trpc/procedures/certificate.ts:15-193`
- Database Schema: `backend/src/db/schema.ts:38-76`

### Filter Logic

1. Build array of WHERE conditions based on provided parameters
2. Combine conditions with AND logic
3. Domain and search use OR logic (match any field)
4. Apply combined WHERE clause to query
5. Calculate total count before pagination
6. Apply sorting and pagination
7. Transform results (parse JSON SAN fields, compute expiry status)

## Future Enhancements

### Planned Improvements

- [ ] Add authentication and authorization
- [ ] Role-based filtering (users see only their certificates)
- [ ] Export functionality (CSV, JSON)
- [ ] Batch operations (bulk revoke, bulk delete)
- [ ] Advanced search with regex support
- [ ] Saved filter presets
- [ ] Real-time updates via WebSocket
- [ ] Certificate health scoring

### Performance Improvements

- [ ] Response caching for common queries
- [ ] Database query optimization
- [ ] Cursor-based pagination for better performance
- [ ] Full-text search index for text queries

## Related Documentation

- **Certificate Issuance**: See doc-002 for certificate creation
- **OpenAPI Specification**: See doc-004 for API documentation access
- **Product Requirements**: See doc-001 for overall system requirements

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2025-10-21 | 1.0 | Initial implementation with full filtering, searching, sorting, and pagination |
