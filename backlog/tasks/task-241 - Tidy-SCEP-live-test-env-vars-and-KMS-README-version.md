---
id: TASK-241
title: Tidy SCEP live-test env vars and KMS README version
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-23 14:06'
updated_date: '2026-10-26 15:40'
labels:
  - scep
  - docs
dependencies: []
ordinal: 68014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Small follow-ups from the PR #18/#19 review: the TestLive* tests read two different token-file variables (SCEP_TEST_TOKEN_FILE vs SCEP_TEST_BACKEND_TOKEN_FILE), and kms/README.md still says 'Cosmian KMS 5.24 schema' while the image is pinned to 5.28.0.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All TestLive* tests run with a single documented set of environment variables
- [ ] #2 kms/README.md names the KMS version that matches the pinned image
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify the claims: two token-file variables across the TestLive* tests, "5.24 schema" in kms/README.md
2. Unify on SCEP_TEST_TOKEN_FILE (already documented in scep/README.md)
3. TestLiveManagedProfileWithKMS: fetch the RA from the backend (RAState) instead of the obsolete SCEP_TEST_RA_STATE_FILE; the backend is the source of truth since #19
4. Document all live-test variables in one table in scep/README.md
5. kms/README.md: name the pinned 5.28 version
6. go vet / go test -race / gofmt; check that the live tests skip cleanly without variables
<!-- SECTION:PLAN:END -->
