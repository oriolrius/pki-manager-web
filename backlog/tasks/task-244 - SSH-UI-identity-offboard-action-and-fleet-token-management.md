---
id: TASK-244
title: 'SSH UI: identity offboard action and fleet token management'
status: To Do
assignee: []
created_date: '2026-11-23T16:26:00Z'
labels:
  - ssh
  - frontend
dependencies: []
ordinal: 71014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The API already has ssh.user.offboard (revoke all active certs + disable identity) and the ssh.token router (mint/list/revoke fleet tokens) but the web UI exposes neither. Add an Offboard action on the SSH users page and a Fleet tokens page in the SSH section.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An admin can Offboard an identity from the SSH users page after a confirm dialog that states the N active certificates revoked, that the identity is disabled, and that it cannot be undone
- [ ] #2 The UI explains the difference between Disable (no revocation) and Offboard (revokes all certs, feeds the KRL)
- [ ] #3 An admin can list fleet tokens of the current zone and revoke one after confirmation
- [ ] #4 An admin can mint a fleet token choosing name, Host/User CA of the zone and ops (with presets); validation mirrors the backend rules
- [ ] #5 The plaintext token is shown once with a copy button and a store-it-safely warning, and is dropped from UI state when dismissed
- [ ] #6 Vitest + RTL tests cover both features; frontend typecheck, test and lint pass
<!-- AC:END -->
