---
id: doc-002
title: 002 - Certificate Issuance API Documentation
type: other
created_date: '2025-10-21 15:26'
---

# Certificate Issuance API Documentation
(related_tasks: task-012)

## Overview

This document describes the certificate issuance API for PKI Manager, specifically the server certificate issuance endpoint. The API enables automated issuance of X.509 TLS/SSL certificates with comprehensive validation, KMS integration, and audit logging.

## Endpoint

### `certificate.issue`

Issues a new server certificate signed by a specified Certificate Authority (CA).

**Type**: Mutation
**Authentication**: Required (via tRPC context)

## Request Schema

```typescript
{
  caId: string;                    // UUID of the issuing CA
  subject: {
    commonName: string;             // Domain name (FQDN)
    organization: string;           // Organization name
    organizationalUnit?: string;    // Optional organizational unit
    country: string;                // 2-letter country code
    state?: string;                 // Optional state/province
    locality?: string;              // Optional city/locality
  };
  certificateType: "server";        // Currently only "server" supported
  keyAlgorithm: "RSA-2048" | "RSA-4096" | "ECDSA-P256" | "ECDSA-P384";
  validityDays: number;             // 1-825 days for server certificates
  sanDns?: string[];                // Optional DNS SANs (supports wildcards)
  sanIp?: string[];                 // Optional IP SANs (IPv4 or IPv6)
  sanEmail?: string[];              // Optional email SANs
  tags?: string[];                  // Optional metadata tags
}
```

## Response Schema

```typescript
{
  id: string;                       // Certificate UUID
  subject: string;                  // Subject DN in string format
  serialNumber: string;             // Unique serial number
  notBefore: string;                // Validity start date (ISO 8601)
  notAfter: string;                 // Validity end date (ISO 8601)
  certificatePem: string;           // Certificate in PEM format
  status: "active";                 // Certificate status
}
```

## Validation Rules

### Certificate Type
- Only `"server"` type is currently supported
- Other types (client, code_signing, email) will be rejected

### Validity Period
- Minimum: 1 day
- Maximum: 825 days (per CA/Browser Forum requirements)
- Validation enforced before certificate generation

### Common Name (CN)
- Must be a valid fully-qualified domain name (FQDN)
- Supports wildcard in first label only (e.g., `*.example.com`)
- Minimum 2 labels required (e.g., `example.com`)
- Each label max 63 characters, total max 253 characters
- Must start and end with alphanumeric characters
- Can contain hyphens but not at start/end of labels

**Valid Examples**:
- `www.example.com`
- `*.example.com`
- `api.staging.example.com`

**Invalid Examples**:
- `example` (single label)
- `*.*.example.com` (multiple wildcards)
- `example.*.com` (wildcard not in first position)
- `-invalid.example.com` (label starts with hyphen)

### Subject Alternative Names (SANs)

#### DNS Names (`sanDns`)
- Same validation rules as Common Name
- Supports wildcards in first label only
- Array of valid domain names

**Examples**:
```json
{
  "sanDns": [
    "www.example.com",
    "*.example.com",
    "api.example.com"
  ]
}
```

#### IP Addresses (`sanIp`)
- Supports both IPv4 and IPv6 addresses
- IPv4: Standard dotted decimal notation (e.g., `192.168.1.1`)
- IPv6: Standard hexadecimal notation (e.g., `2001:db8::1`)

**IPv4 Examples**:
- `192.168.1.1`
- `10.0.0.1`
- `172.16.0.1`

**IPv6 Examples**:
- `2001:0db8:85a3:0000:0000:8a2e:0370:7334`
- `2001:db8:85a3::8a2e:370:7334` (compressed)
- `::1` (loopback)
- `fe80::1` (link-local)

### CA Validation
The specified CA must meet the following criteria:
- Must exist in the database
- Status must be `"active"`
- Must not be expired (`notAfter` > current time)

## Certificate Extensions

The generated certificate includes the following X.509 v3 extensions:

### Basic Constraints
- `cA`: false (not a CA certificate)
- Critical: true

### Key Usage
- Digital Signature
- Key Encipherment
- Critical: true

### Extended Key Usage
- Server Authentication (1.3.6.1.5.5.7.3.1)
- Critical: false

### Subject Alternative Names
- Populated from `sanDns`, `sanIp`, and `sanEmail` request fields
- Critical: false

### Subject Key Identifier
- Automatically generated from public key
- Critical: false

### Authority Key Identifier
- References the issuing CA's key identifier
- Critical: false

### CRL Distribution Point
- **Not currently implemented**
- Requires CRL infrastructure setup (future enhancement)

## KMS Integration

### Key Pair Generation
1. New RSA or ECDSA key pair generated in KMS
2. Key size determined by `keyAlgorithm` parameter:
   - RSA-2048: 2048 bits
   - RSA-4096: 4096 bits
   - ECDSA-P256: P-256 curve
   - ECDSA-P384: P-384 curve

### Certificate Signing
- Certificate signed using CA's private key stored in KMS
- KMS performs signing operation via `certify` operation
- Private keys never leave KMS environment
- Serial number generated by KMS (cryptographically unique)

## Database Storage

Certificate records are stored with the following metadata:

```typescript
{
  id: string;                       // Certificate UUID
  caId: string;                     // Issuing CA ID
  subjectDn: string;                // Subject DN string
  serialNumber: string;             // Unique serial number
  certificateType: "server";        // Certificate type
  notBefore: Date;                  // Validity start
  notAfter: Date;                   // Validity end
  certificatePem: string;           // PEM-encoded certificate
  kmsKeyId: string;                 // KMS private key ID
  status: "active";                 // Initial status
  sanDns: string | null;            // JSON array of DNS SANs
  sanIp: string | null;             // JSON array of IP SANs
  sanEmail: string | null;          // JSON array of email SANs
  createdAt: Date;                  // Creation timestamp
  updatedAt: Date;                  // Last update timestamp
}
```

## Audit Logging

All certificate issuance attempts (success and failure) are logged:

```typescript
{
  id: string;                       // Audit log entry UUID
  operation: "certificate.issue";   // Operation type
  entityType: "certificate";        // Entity type
  entityId: string;                 // Certificate ID
  status: "success" | "failure";    // Operation result
  details: {                        // Operation details (JSON)
    caId: string;
    certificateType: string;
    subject: string;
    keyAlgorithm: string;
    validityDays: number;
    serialNumber?: string;
    kmsKeyId?: string;
    sanDns?: string[];
    sanIp?: string[];
    sanEmail?: string[];
    error?: string;                 // On failure
  };
  ipAddress: string | null;         // Client IP address
  timestamp: Date;                  // Operation timestamp
}
```

## Error Handling

### Validation Errors (400 Bad Request)

**Invalid Certificate Type**:
```json
{
  "code": "BAD_REQUEST",
  "message": "Only server certificate type is supported in this endpoint"
}
```

**Invalid Validity Period**:
```json
{
  "code": "BAD_REQUEST",
  "message": "Validity days cannot exceed 825 days"
}
```

**Invalid Common Name**:
```json
{
  "code": "BAD_REQUEST",
  "message": "Invalid common name: Domain name must have at least two labels"
}
```

**Invalid SANs**:
```json
{
  "code": "BAD_REQUEST",
  "message": "Invalid SANs: Invalid SAN DNS name '*.*.example.com': Wildcard (*) can only appear at the beginning"
}
```

### CA Errors

**CA Not Found (404)**:
```json
{
  "code": "NOT_FOUND",
  "message": "CA with ID {caId} not found"
}
```

**CA Not Active (400)**:
```json
{
  "code": "BAD_REQUEST",
  "message": "CA is not active (status: revoked)"
}
```

**CA Expired (400)**:
```json
{
  "code": "BAD_REQUEST",
  "message": "CA certificate has expired"
}
```

### System Errors (500 Internal Server Error)

```json
{
  "code": "INTERNAL_SERVER_ERROR",
  "message": "Failed to issue certificate: {error details}"
}
```

## Example Usage

### Basic Server Certificate

```typescript
const result = await trpc.certificate.issue.mutate({
  caId: "550e8400-e29b-41d4-a716-446655440000",
  subject: {
    commonName: "www.example.com",
    organization: "Example Corp",
    country: "US",
  },
  certificateType: "server",
  keyAlgorithm: "RSA-2048",
  validityDays: 90,
});

console.log(result.certificatePem);
```

### Certificate with SANs

```typescript
const result = await trpc.certificate.issue.mutate({
  caId: "550e8400-e29b-41d4-a716-446655440000",
  subject: {
    commonName: "example.com",
    organization: "Example Corp",
    organizationalUnit: "IT Department",
    country: "US",
    state: "California",
    locality: "San Francisco",
  },
  certificateType: "server",
  keyAlgorithm: "RSA-4096",
  validityDays: 365,
  sanDns: [
    "example.com",
    "www.example.com",
    "*.example.com",
    "api.example.com",
  ],
  sanIp: [
    "192.168.1.100",
    "2001:db8::1",
  ],
  tags: ["production", "web-server"],
});
```

### Wildcard Certificate

```typescript
const result = await trpc.certificate.issue.mutate({
  caId: "550e8400-e29b-41d4-a716-446655440000",
  subject: {
    commonName: "*.example.com",
    organization: "Example Corp",
    country: "US",
  },
  certificateType: "server",
  keyAlgorithm: "ECDSA-P256",
  validityDays: 180,
  sanDns: ["*.example.com", "example.com"],
});
```

## Security Considerations

1. **Private Key Security**: Private keys are generated and stored in KMS, never exposed
2. **CA Private Key**: CA signing operations performed entirely within KMS
3. **Serial Number Uniqueness**: Ensured by KMS cryptographic generation
4. **Validity Period Limits**: Enforced maximum of 825 days per industry standards
5. **Input Validation**: Comprehensive validation prevents injection and malformed data
6. **Audit Trail**: All operations logged for security and compliance

## Known Limitations

1. **Certificate Extensions**: Current implementation uses KMS `certify` operation which may have limited extension support. Custom extensions (CRL Distribution Point, specific Key Usage flags) may not be fully honored by KMS.

2. **CRL Distribution Point**: Not currently added to certificates. Requires CRL infrastructure setup (planned for future implementation).

3. **Certificate Types**: Only server certificates currently supported. Client, code signing, and email certificates will be implemented in future tasks.

## Future Enhancements

1. **Full Extension Support**: Implement local certificate generation with KMS-based signing to support all X.509 extensions
2. **CRL Distribution Point**: Add CRL DP extension when CRL infrastructure is ready
3. **Additional Certificate Types**: Support for client, code signing, and email certificates
4. **Custom Extensions**: Support for custom/proprietary certificate extensions
5. **Certificate Templates**: Pre-configured templates for common use cases

## Related Documentation

- **Product Requirements**: doc-001 - PKI-Manager-Product-Requirements-Document.md
- **Implementation Task**: task-012 - Implement certificate issuance backend for server certificates

## Revision History

| Date       | Version | Author  | Changes                           |
|------------|---------|---------|-----------------------------------|
| 2025-10-21 | 1.0     | @claude | Initial documentation creation    |
