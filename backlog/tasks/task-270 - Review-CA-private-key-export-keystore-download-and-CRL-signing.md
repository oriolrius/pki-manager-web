---
id: TASK-270
title: Review CA private key export (keystore download and CRL signing)
status: To Do
assignee: []
created_date: '2026-11-24T10:33:00Z'
updated_date: '2026-11-24T11:04:00Z'
labels:
  - security
dependencies: []
priority: high
ordinal: 90014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CA private key leaves the KMS in two cases: CRL signing exports it to backend memory (decision-010), and GET /api/v1/cas/{id}/download with p12-keystore/jks-keystore returns it to the user. Docs used to say CA keys never leave the KMS (corrected 2026-11-24). Decide who may export a CA key, whether it should be possible at all, and audit it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Only an explicit, audited admin action can export a CA private key, or the export is removed
- [ ] #2 The docs state exactly when a CA private key leaves the KMS
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GitHub: https://github.com/oriolrius/pki-manager-web/security/advisories/GHSA-59wc-9fpc-hv58
<!-- SECTION:NOTES:END -->
