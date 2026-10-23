---
id: TASK-241
title: Tidy SCEP live-test env vars and KMS README version
status: To Do
assignee: []
created_date: '2026-10-23 14:06'
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
