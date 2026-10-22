---
id: TASK-238
title: Generalize CA-bound integration identities and service tokens
status: To Do
assignee: []
created_date: '2026-10-22T10:36:00Z'
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
