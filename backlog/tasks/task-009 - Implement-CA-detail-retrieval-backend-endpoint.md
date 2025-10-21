---
id: task-009
title: Implement CA detail retrieval backend endpoint
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:49'
updated_date: '2025-10-21 17:18'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze requirements for CA detail retrieval
2. Implement ca.getById tRPC endpoint
3. Retrieve CA record from database by ID
4. Parse certificate to extract detailed fields
5. Parse and extract extensions (Key Usage, Basic Constraints, SKI)
6. Calculate certificate fingerprints (SHA-256, SHA-1)
7. Compute validity status based on current date
8. Count and include issued certificate count
9. Handle CA not found error case
<!-- SECTION:PLAN:END -->
