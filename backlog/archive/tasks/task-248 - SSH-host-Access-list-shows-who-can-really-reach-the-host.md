---
id: TASK-248
title: SSH host Access list shows who can really reach the host
status: Done
assignee:
  - '@claude'
created_date: '2026-11-23T18:57:00Z'
updated_date: '2026-11-23T19:13:00Z'
labels:
  - ssh
  - backend
  - frontend
dependencies: []
ordinal: 75014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ssh.host.access joins host mappings only with grants (ssh_user_principals). Grants had no UI, so in normal use the Access list is empty even when several people hold certificates that log in to the host. Also include identities that hold a live user certificate whose principals match a mapping on the host, and show where each row comes from.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Access list includes every same-zone identity with an active, unexpired, non-revoked user certificate whose principals (bare P or P@<host fqdn>) match a mapping on the host
- [x] #2 Each row shows its source: certificate, grant, or both, with correct via roles and local accounts
- [x] #3 Certificates and grants from another zone, expired or revoked certificates, and P@<other host> principals do not add rows
- [x] #4 Block / unblock behaviour and blocked rows are unchanged
- [x] #5 The host Access card shows the row source in a subtle way
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. hostAccess: load host maps (role -> accounts), then grants and live user certs of the host zone; match bare P and P@<fqdn>; skip status/serial/key/key-id revoked certs.
2. Tag rows with source; keep block merge as is; return zoneId.
3. HostAccessCard: source tag + zone-filtered Block user list.
4. Tests backend + RTL; docs row.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The host Access list now shows who can really reach the host.

- `SshBlockService.hostAccess` merges two sources per identity: grants (as before) and live user certificates (active, validBefore > now, not revoked by status or by a serial / key-fingerprint / key-id directive) whose principals match a host mapping as `P` or `P@<fqdn>`. Identity, CA and principals must be in the host zone.
- Each entry has `source`: `certificate` | `grant` | `both` (null for a block-only row). `viaRoles` / `localAccounts` merge both. Response also has `zoneId`. Blocks untouched.
- HostAccessCard: "· certificate", "· grant", "· certificate + grant" tag with hover text; "Block user…" limited to the host zone.
- docs/ssh-api-contract.md access row updated.
- Tests: ssh-host-access-sources.test.ts (backend), HostAccessCard.test.tsx (frontend).
<!-- SECTION:NOTES:END -->
