---
id: task-014
title: Implement certificate detail retrieval backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:50'
updated_date: '2025-10-21 18:12'
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

- [ ] #11 Unit tests validate endpoint functionality and error handling
<!-- AC:END -->
