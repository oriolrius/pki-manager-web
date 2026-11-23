---
id: TASK-248
title: SSH host Access list shows who can really reach the host
status: To Do
assignee: []
created_date: '2026-11-23T18:57:00Z'
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
- [ ] #1 The Access list includes every same-zone identity with an active, unexpired, non-revoked user certificate whose principals (bare P or P@<host fqdn>) match a mapping on the host
- [ ] #2 Each row shows its source: certificate, grant, or both, with correct via roles and local accounts
- [ ] #3 Certificates and grants from another zone, expired or revoked certificates, and P@<other host> principals do not add rows
- [ ] #4 Block / unblock behaviour and blocked rows are unchanged
- [ ] #5 The host Access card shows the row source in a subtle way
<!-- AC:END -->
