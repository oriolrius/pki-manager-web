---
id: task-007
title: Implement CA creation backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:49'
updated_date: '2025-10-21 17:16'
labels:
  - backend
  - ca
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for creating root Certificate Authorities. Generate key pair in KMS, create self-signed certificate, store in database, and create audit log entry.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ca.create tRPC endpoint implemented
- [ ] #2 Input validation with Zod schema
- [ ] #3 Key pair generated in KMS
- [ ] #4 Self-signed root certificate created
- [ ] #5 CA record stored in database with KMS key ID
- [ ] #6 Audit log entry created for CA creation
- [ ] #7 Certificate returned in PEM format
- [ ] #8 Error handling for KMS failures
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze requirements and existing code structure
2. Implement ca.create tRPC endpoint with input validation
3. Generate key pair in KMS and retrieve public key
4. Create self-signed root certificate using KMS certify operation
5. Store CA record in database with all required fields
6. Create audit log entry for CA creation
7. Test error handling for KMS failures
8. Verify all acceptance criteria are met
<!-- SECTION:PLAN:END -->
