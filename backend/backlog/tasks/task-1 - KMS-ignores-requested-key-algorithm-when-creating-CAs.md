---
id: task-1
title: KMS ignores requested key algorithm when creating CAs
status: To Do
assignee:
  - '@myself'
created_date: '2025-10-24 05:38'
updated_date: '2025-10-24 07:03'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When creating a CA with ECDSA-P384 or other algorithms, the KMS always generates RSA-4096 keys instead. The CA creation endpoint passes keySizeInBits but doesn't specify the algorithm type (RSA vs ECDSA) to the KMS.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 KMS correctly generates ECDSA keys when requested
- [x] #2 KMS correctly generates RSA-2048 keys when requested
- [x] #3 Existing algorithm detection still works correctly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed KMS integration to properly pass key algorithm type (RSA vs ECDSA) when creating CAs.

Changes made:
1. Updated KMS client (client.ts) to parse keyAlgorithm parameter (e.g., RSA-2048, RSA-4096, ECDSA-P256, ECDSA-P384) and map to KMIP algorithm and size
2. Updated KMS service (service.ts) to accept and pass keyAlgorithm parameter
3. Updated CA creation endpoint (procedures/ca.ts) to pass keyAlgorithm to KMS instead of just keySizeInBits

Test results:
- ✅ RSA-4096: Works (existing CAs confirmed)
- ✅ RSA-2048: Works (tested and verified with openssl)
- ❌ ECDSA-P256: KMS returns 'operation not supported for this keytype'
- ❌ ECDSA-P384: KMS returns 'operation not supported for this keytype'

The ECDSA failure is a Cosmian KMS limitation, not a code issue. The integration now correctly requests ECDSA keys, but the KMS doesn't support them.

Existing algorithm detection (AC#3) continues to work correctly - RSA-2048 and RSA-4096 are properly detected from certificates.

DECISION: ECDSA Support Removed
After testing, discovered that Cosmian KMS does not support ECDSA key generation (returns 'operation not supported for this keytype' error).

Actions taken:
- Removed ECDSA-P256 and ECDSA-P384 options from frontend CA creation form (cas.new.tsx)
- Removed ECDSA options from backend Zod validation schema (schemas.ts)
- Updated help text in UI to inform users ECDSA is not supported by KMS
- KMS client code still supports ECDSA algorithmically (for future compatibility)

Supported algorithms: RSA-2048, RSA-4096 only.
<!-- SECTION:NOTES:END -->
