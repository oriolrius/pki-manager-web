---
id: task-015
title: Implement certificate renewal backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 19:44'
labels:
  - backend
  - certificate
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for renewing certificates. Support generating new keys or reusing existing keys, copying or updating certificate information, and linking renewal chain.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 certificate.renew endpoint implemented
- [x] #2 Option to generate new key pair or reuse existing
- [x] #3 Subject DN copied from original (or updated)
- [x] #4 SAN copied from original (or updated)
- [x] #5 New serial number generated
- [x] #6 Renewal chain tracked (renewed_from_id)
- [x] #7 Option to revoke original certificate
- [x] #8 Validation: cannot renew revoked certificates
- [x] #9 Validation: key reuse only if original < 90 days old
- [x] #10 Audit log links renewal to original

- [x] #11 Unit tests written for renewal logic
- [x] #12 Integration tests for renewal endpoint
- [x] #13 All tests pass before marking as done
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Examine existing certificate creation logic and database schema
2. Define tRPC input schema for renewal options (key reuse, DN/SAN updates, revocation)
3. Implement renewal logic: validate original cert, generate/reuse keys, create new cert
4. Add validation rules (no renewal of revoked certs, key age check)
5. Track renewal chain (renewed_from_id) and optional revocation
6. Add audit logging for renewal actions
7. Write unit tests for validation and renewal logic
8. Write integration tests for the endpoint
9. Run all tests to ensure they pass
<!-- SECTION:PLAN:END -->
