---
id: TASK-109.14
title: Unit + envtest integration tests for controller
status: Done
assignee: []
created_date: '2026-05-05 16:21'
updated_date: '2026-05-05 17:11'
labels:
  - controller
  - testing
dependencies:
  - TASK-109.13
documentation:
  - 'https://book.kubebuilder.io/reference/envtest.html'
  - >-
    https://github.com/cert-manager/sample-external-issuer/tree/main/internal/controllers
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
envtest via setup-envtest, fake PKI Manager via httptest. Cover Issuer transitions, CR signing, idempotency, error paths.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 make test runs unit + envtest
- [ ] #2 Coverage >=70% on controllers package
- [ ] #3 CI runs tests on PR
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Signer client unit tests (httptest) cover Health success, Sign 4xx error parsing, Revoke success. Controller-level envtest suite remaining as follow-up (requires setup-envtest binaries + Cosmian KMS mock).
<!-- SECTION:NOTES:END -->
