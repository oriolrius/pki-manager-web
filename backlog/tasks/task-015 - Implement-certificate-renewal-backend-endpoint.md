---
id: task-015
title: Implement certificate renewal backend endpoint
status: To Do
assignee: []
created_date: '2025-10-21 15:50'
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
<!-- AC:END -->
