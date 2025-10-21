---
id: task-009
title: Implement CA detail retrieval backend endpoint
status: To Do
assignee: []
created_date: '2025-10-21 15:49'
labels:
  - backend
  - ca
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the tRPC endpoint for retrieving detailed information about a specific root CA including certificate details, extensions, and statistics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ca.getById tRPC endpoint implemented
- [ ] #2 Complete CA information returned
- [ ] #3 Certificate parsed and fields extracted
- [ ] #4 Extensions parsed (Key Usage, Basic Constraints, SKI)
- [ ] #5 Certificate fingerprints calculated (SHA-256, SHA-1)
- [ ] #6 Validity status computed
- [ ] #7 Issued certificate count included
- [ ] #8 Error handling for CA not found
<!-- AC:END -->
