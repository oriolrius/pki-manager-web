---
id: TASK-113
title: Regenerate CRL on revocation and before nextUpdate
status: Done
assignee: []
created_date: '2026-06-29 14:03'
updated_date: '2026-06-29 14:46'
labels:
  - crl
  - backend
milestone: CRL Signing & Distribution
dependencies:
  - TASK-111
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A revoked certificate must appear in the CA CRL promptly, and the CRL must be refreshed before it expires. Trigger regeneration from all revoke paths (tRPC, REST, external /revoke) and on a schedule/lazily before nextUpdate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Revoking a cert via tRPC, REST, or the external /revoke endpoint regenerates its CA CRL so the serial appears
- [x] #2 The CRL is regenerated before nextUpdate elapses (scheduled or on-demand), with crlNumber increasing each time
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added CRLService.regenerateForCa (best-effort). Wired into all revoke paths: certificate.service.revoke (REST), tRPC certificate.revoke (inline), external /revoke. Public /crl endpoint lazily regenerates when past nextUpdate. crlNumber increments each regen (tested). See crl-revocation.test.ts.
<!-- SECTION:NOTES:END -->
