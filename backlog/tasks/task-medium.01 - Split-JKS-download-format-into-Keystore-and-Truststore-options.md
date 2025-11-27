---
id: task-medium.01
title: Split JKS download format into Keystore and Truststore options
status: To Do
assignee: []
created_date: '2025-11-27 12:28'
labels:
  - feature
  - certificates
  - download
dependencies: []
parent_task_id: task-medium
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
- [ ] #1 JKS format split into 'JKS Keystore' and 'JKS Truststore' options in download dropdown
- [ ] #2 Keystore contains certificate(s) with private keys (PrivateKeyEntry)
- [ ] #3 Truststore contains only CA certificates without private keys (TrustedCertEntry)
- [ ] #4 Info popup after download explains the use case for each type
- [ ] #5 Both single certificate and bulk download support both JKS variants
<!-- AC:END -->
