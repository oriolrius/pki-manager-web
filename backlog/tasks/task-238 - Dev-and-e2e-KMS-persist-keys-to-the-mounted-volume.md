---
id: TASK-238
title: Dev and e2e KMS persist keys to the mounted volume
status: To Do
assignee: []
created_date: '2026-10-22 19:43'
labels:
  - kms
  - dev
dependencies: []
ordinal: 65014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
kms/kms.toml used pre-5.24 keys ([server], [database] type/path) that Cosmian KMS 5.24 silently ignores, so the dev/e2e KMS stored SQLite in the container layer and lost every key on recreate. Found while reviewing PR #19.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Recreating the dev KMS container keeps every KMS object (same ckms locate inventory before and after)
- [ ] #2 The KMS startup log reports the mounted /cosmian-kms/sqlite-data as main_db_params
- [ ] #3 kms/README.md explains how to rescue a database left inside an old container
<!-- AC:END -->
