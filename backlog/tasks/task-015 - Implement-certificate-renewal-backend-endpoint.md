---
id: task-015
title: Implement certificate renewal backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 19:40'
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
- [ ] #1 certificate.renew endpoint implemented
- [ ] #2 Option to generate new key pair or reuse existing
- [ ] #3 Subject DN copied from original (or updated)
- [ ] #4 SAN copied from original (or updated)
- [ ] #5 New serial number generated
- [ ] #6 Renewal chain tracked (renewed_from_id)
- [ ] #7 Option to revoke original certificate
- [ ] #8 Validation: cannot renew revoked certificates
- [ ] #9 Validation: key reuse only if original < 90 days old
- [ ] #10 Audit log links renewal to original

- [ ] #11 Unit tests written for renewal logic
- [ ] #12 Integration tests for renewal endpoint
- [ ] #13 All tests pass before marking as done
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
