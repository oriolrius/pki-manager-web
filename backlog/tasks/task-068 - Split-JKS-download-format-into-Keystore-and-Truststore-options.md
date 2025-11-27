---
id: task-068
title: Split JKS download format into Keystore and Truststore options
status: Done
assignee: []
created_date: '2025-11-27 12:29'
updated_date: '2025-11-27 12:39'
labels:
  - feature
  - certificates
  - download
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently, the JKS download format creates a single keystore containing both certificates with private keys and CA certificates as trusted entries. This should be split into two distinct download options:

1. **JKS Keystore** - Contains the certificate(s) with their private keys. Used when an application needs to present its own identity (e.g., server SSL, client authentication).

2. **JKS Truststore** - Contains only CA certificates (no private keys). Used when an application needs to verify certificates presented by others (e.g., trusting a CA for client certificate validation).

## Key Differences:

| Aspect | Keystore | Truststore |
|--------|----------|------------|
| Contains | Certificate + Private Key | CA certificates only |
| Purpose | Prove identity | Verify others |
| Entry type | PrivateKeyEntry | TrustedCertEntry |
| Security | High (has private keys) | Lower (public certs only) |
| Use case | Server TLS, client auth | CA trust validation |

## Files to modify:
- `backend/src/trpc/schemas.ts` - Add jks-keystore and jks-truststore formats
- `backend/src/trpc/procedures/certificate.ts` - Implement separate handlers
- `frontend/src/routes/certificates.$id.tsx` - Add both format options with descriptions
- `frontend/src/routes/certificates.tsx` - Add both format options for bulk download

## Info popup should explain:
- Keystore: "Use this when your application needs to present this certificate (e.g., configuring HTTPS on a server)"
- Truststore: "Use this when your application needs to trust certificates signed by this CA (e.g., validating client certificates)"
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 JKS format split into 'JKS Keystore' and 'JKS Truststore' options in download dropdown
- [x] #2 Keystore contains certificate(s) with private keys (PrivateKeyEntry)
- [x] #3 Truststore contains only CA certificates without private keys (TrustedCertEntry)
- [x] #4 Info popup after download explains the use case for each type
- [x] #5 Both single certificate and bulk download support both JKS variants
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

Split JKS download format into two distinct options:

### JKS Keystore (`jks-keystore`)
- Contains certificate + private key as PrivateKeyEntry
- For server identity use cases (SSL/TLS server auth, client cert auth)
- Requires password for export

### JKS Truststore (`jks-truststore`)
- Contains CA certificate only as TrustedCertEntry
- For trust validation use cases (validating client certs, trusting private CA)
- No private key required

### Files Modified
- `backend/src/trpc/schemas.ts` - Updated format enums
- `backend/src/trpc/procedures/certificate.ts` - Separate handlers for each format
- `frontend/src/routes/certificates.$id.tsx` - Single cert download UI with type-specific popups
- `frontend/src/routes/certificates.tsx` - Bulk download UI with type-specific popups
<!-- SECTION:NOTES:END -->
