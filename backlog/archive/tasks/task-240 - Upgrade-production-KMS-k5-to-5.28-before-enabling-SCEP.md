---
id: TASK-240
title: Upgrade production KMS (k5) to 5.28 before enabling SCEP
status: To Do
assignee: []
created_date: '2026-10-23 14:06'
labels:
  - kms
  - prod
  - scep
dependencies: []
ordinal: 67014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decision 2026-10-22 (Option A): upgrade the prod Cosmian KMS from 5.24.0 to 5.28.0 as a separate change, with a full backup and testing beforehand. KMS 5.24 reuses serials on same-key SCEP RA renewal. Prod also has to move to config-file mode (kms.toml + COSMIAN_KMS_CONF), because default mode rejects Activate. Do not start without Oriol's go-ahead.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A full offline KMS backup exists and has been restore-tested before the upgrade
- [ ] #2 After the upgrade, existing CA keys sign certificates and CRLs and the SSH CA keeps working
- [ ] #3 SCEP RA renewal issues a fresh serial on the production KMS
<!-- AC:END -->
