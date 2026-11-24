---
id: TASK-258
title: 'Guide: integrations, service identities and SCEP'
status: Done
assignee: []
created_date: '2026-11-24T09:15:00Z'
updated_date: '2026-11-24T10:26:00Z'
labels:
  - docs
milestone: m-1
dependencies:
  - TASK-254
  - TASK-251
ordinal: 78014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Service identities and tokens for automation, external issuer endpoints, issuance policy and audit, backend-owned SCEP RA.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each integration has one working example verified against the demo stack
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- docs/guides/integrations.md (site: guides/automation): token scope (real 401/403), external sign with curl + openssl verify, CA:TRUE rejection (400 CSR_PROFILE_REJECTED) and its audit row, rotate/revoke, SCEP enrollment through the published scep:3.15.0 gateway (scep TestLiveEnrollment as client) + openssl verify. Not run: HTTPS/rate-limit proxy, Intune/webhook modes, SCEP renewal, real devices (stated in the guide).
- Fixed docs/api/integrations.md (durationDays >825 is 400; revoke default reason unspecified). Filed TASK-263 (tRPC 401 leaks stack trace, security) and TASK-269 (micromdm scepclient gets 415).
<!-- SECTION:NOTES:END -->
