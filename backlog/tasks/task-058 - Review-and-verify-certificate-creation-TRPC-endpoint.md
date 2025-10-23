---
id: task-058
title: Review and verify certificate creation TRPC endpoint
status: To Do
assignee: []
created_date: '2025-10-23 16:02'
labels:
  - backend
  - trpc
  - certificate
  - review
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review the certificate.issue TRPC endpoint implementation to ensure it follows the same patterns and best practices as the CA creation endpoint, with proper KMS integration, validation, and minimal schema compliance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Certificate creation endpoint uses KMS for key generation and certificate signing
- [ ] #2 All certificate types (server, client, code_signing, email) have proper validation
- [ ] #3 Minimal schema is correctly implemented (fetches from KMS, stores only metadata)
- [ ] #4 Audit logging is present for success and failure cases
- [ ] #5 Error handling follows the same pattern as CA creation
- [ ] #6 Certificate metadata (SANs, extensions) is properly stored and retrieved
- [ ] #7 Tests exist and pass for certificate creation endpoint
- [ ] #8 KMS integration works correctly with issuer CA keys
<!-- AC:END -->
