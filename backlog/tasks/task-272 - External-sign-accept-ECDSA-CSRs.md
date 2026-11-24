---
id: TASK-272
title: 'External sign: accept ECDSA CSRs'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T10:44:00Z'
updated_date: '2026-11-24T14:42:00Z'
labels:
  - integrations
dependencies: []
ordinal: 92014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
POST /api/v1/external/sign parses CSRs with node-forge, which reads RSA keys only: an ECDSA P-256 CSR returns 400 INVALID_CSR "Cannot read public key. OID is not RSA." (found by the docs API how-to, 2026-11-24). The management API can issue ECDSA certificates, so devices and cert-manager users expect ECDSA CSRs to work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An ECDSA P-256 and P-384 CSR is signed by the external API
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
GitHub: https://github.com/oriolrius/pki-manager-web/issues/28

Fixed in PR #38 (merged into main 2026-11-24).
<!-- SECTION:NOTES:END -->
