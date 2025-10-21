---
id: task-012
title: Implement certificate issuance backend for server certificates
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 17:38'
labels:
  - backend
  - certificate
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for issuing server (TLS/SSL) certificates. Generate key pair in KMS, create CSR, sign with CA key, store certificate, and create audit log entry.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 certificate.issue endpoint implemented for server type
- [ ] #2 Input validation for server certificate fields
- [ ] #3 Domain name validation for CN
- [ ] #4 SAN DNS names validation (including wildcards)
- [ ] #5 SAN IP addresses validation (IPv4/IPv6)
- [ ] #6 Key pair generated in KMS
- [ ] #7 Certificate signed by CA private key via KMS
- [ ] #8 Certificate stored in database with metadata
- [ ] #9 CRL Distribution Point extension added
- [ ] #10 Key Usage and Extended Key Usage set correctly
- [ ] #11 Maximum validity of 825 days enforced
- [ ] #12 Serial number unique per CA
- [ ] #13 Audit log entry created
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create validation utilities for domain names and SANs
2. Implement the certificate.issue endpoint:
   - Validate input fields (server type, DN, SANs, validity)
   - Retrieve and validate CA exists and is active
   - Generate unique serial number for certificate
   - Create key pair in KMS
   - Prepare certificate parameters with extensions
   - Sign certificate using CA private key via KMS
   - Store certificate in database
   - Create audit log entry
3. Add proper error handling and logging
4. Test with various inputs
<!-- SECTION:PLAN:END -->
