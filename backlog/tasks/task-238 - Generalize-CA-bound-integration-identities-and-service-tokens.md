---
id: TASK-238
title: Generalize CA-bound integration identities and service tokens
status: In Progress
assignee:
  - '@codex'
created_date: '2026-10-22T10:36:00Z'
updated_date: '2026-10-22T10:37:00Z'
labels: []
dependencies: []
ordinal: 65014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace Kubernetes-specific token ownership with generic typed integrations across persistence, backend, APIs and frontend, preserving existing tokens and legacy cluster endpoints.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migration preserves existing token hashes and certificate ownership under integrations
- [ ] #2 Generic integration API supports Kubernetes, SCEP and generic identities; legacy cluster API remains compatible
- [ ] #3 External issuance, status, retry and revocation are scoped to integration and correctly classify SCEP certificates
- [ ] #4 Frontend creates typed integrations and uses the generic API; compatibility and isolation tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add canonical integrations persistence with typed identities and migrate token hashes and certificate ownership.
2. Introduce generic integration service/router/auth and retain cluster compatibility adapters.
3. Update issuance provenance and UI with integration types; test migration, isolation, revoked tokens, legacy API and live SCEP.
<!-- SECTION:PLAN:END -->
