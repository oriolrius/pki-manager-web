---
id: task-014
title: Implement certificate detail retrieval backend endpoint
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
Implement the tRPC endpoint for retrieving comprehensive details about a specific certificate including all fields, extensions, and status information.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 certificate.getById endpoint implemented
- [ ] #2 Complete certificate information parsed and returned
- [ ] #3 Subject and Issuer DN parsed
- [ ] #4 All extensions parsed (Key Usage, EKU, SAN, etc.)
- [ ] #5 Fingerprints calculated (SHA-256, SHA-1)
- [ ] #6 Validity status computed
- [ ] #7 Remaining validity days calculated
- [ ] #8 Issuing CA information included
- [ ] #9 Renewal chain tracked (if renewed)
- [ ] #10 Error handling for certificate not found
<!-- AC:END -->
