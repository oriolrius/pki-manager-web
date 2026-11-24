---
id: TASK-244
title: 'SSH UI: identity offboard action and fleet token management'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-23T16:26:00Z'
updated_date: '2026-11-23T16:31:00Z'
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
- [x] #1 An admin can Offboard an identity from the SSH users page after a confirm dialog that states the N active certificates revoked, that the identity is disabled, and that it cannot be undone
- [x] #2 The UI explains the difference between Disable (no revocation) and Offboard (revokes all certs, feeds the KRL)
- [x] #3 An admin can list fleet tokens of the current zone and revoke one after confirmation
- [x] #4 An admin can mint a fleet token choosing name, Host/User CA of the zone and ops (with presets); validation mirrors the backend rules
- [x] #5 The plaintext token is shown once with a copy button and a store-it-safely warning, and is dropped from UI state when dismissed
- [x] #6 Vitest + RTL tests cover both features; frontend typecheck, test and lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Offboard: add components/ssh/offboard-flow.ts (pure flow, DI) + OffboardDialogBody; wire into ssh.users.tsx next to Disable.
2. Tokens: add components/ssh/fleet-token.ts (presets, validation) and routes/ssh.tokens.tsx; nav entry in ssh.tsx.
3. Tests for both; typecheck/test/lint.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added the missing UI for two existing API features (no backend change).

- Offboard: new button next to Disable on /ssh/users; confirm dialog states N active certificates revoked, identity disabled, irreversible; optional reason; Disable vs Offboard hints and updated Disable dialog text.
- Fleet tokens: new /ssh/tokens page (nav: Administration > Fleet tokens). Zone-scoped table, revoke with confirm, mint form with presets, CA pickers (active CAs of the zone) and op help. Plaintext token shown once with Copy and a store-it warning; kept only in component state (mutation cache reset).
- Token list endpoint is not zone-filtered, so the UI filters by zoneId.
- Tests: offboard-flow, users page Offboard, fleet-token helpers, FleetTokensPanel. frontend typecheck and test pass.
- Lint: eslint . reports problems only in files this change does not touch (pre-existing); touched/new files are clean.
<!-- SECTION:NOTES:END -->
