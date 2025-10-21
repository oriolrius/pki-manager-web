---
id: task-006
title: Implement X.509 certificate generation utilities
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:49'
updated_date: '2025-10-21 16:46'
labels:
  - backend
  - pki
  - crypto
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create utility functions for generating X.509 certificates, CSRs, and CRLs. Implement support for multiple key algorithms (RSA, ECDSA) and signature algorithms. Ensure RFC 5280 compliance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Certificate generation function with configurable parameters
- [ ] #2 CSR generation function implemented
- [ ] #3 CRL generation function implemented
- [ ] #4 Support for RSA-2048, RSA-4096, ECDSA-P256, ECDSA-P384
- [ ] #5 Distinguished Name parsing and formatting
- [ ] #6 Subject Alternative Names (SAN) support
- [ ] #7 X.509 v3 extensions support (Key Usage, EKU, etc.)
- [ ] #8 Certificate serialization to PEM and DER formats
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Check available crypto libraries and choose between node:crypto and node-forge
2. Install necessary dependencies if needed
3. Create /backend/src/crypto directory structure with:
   - x509.ts (certificate generation)
   - csr.ts (CSR generation)
   - crl.ts (CRL generation)
   - types.ts (interfaces and types)
   - index.ts (barrel exports)
4. Implement Distinguished Name parsing and formatting utilities
5. Implement certificate generation with configurable parameters (AC #1)
6. Implement CSR generation (AC #2)
7. Implement CRL generation (AC #3)
8. Add support for all key algorithms: RSA-2048, RSA-4096, ECDSA-P256, ECDSA-P384 (AC #4)
9. Implement SAN support (AC #6)
10. Implement X.509 v3 extensions (Key Usage, EKU, etc.) (AC #7)
11. Implement PEM/DER serialization (AC #8)
12. Write unit tests for all utilities
13. Integrate with existing KMS service for signing operations
<!-- SECTION:PLAN:END -->
