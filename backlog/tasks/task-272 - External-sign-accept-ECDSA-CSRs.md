---
id: TASK-272
title: 'External sign: accept ECDSA CSRs'
status: To Do
assignee: []
created_date: '2026-11-24T10:44:00Z'
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
- [ ] #1 An ECDSA P-256 and P-384 CSR is signed by the external API
<!-- AC:END -->
