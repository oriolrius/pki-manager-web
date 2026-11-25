---
id: TASK-212
title: >-
  SSH Principals: pick a host from a list instead of stacking every host's
  mapping card
status: Done
assignee:
  - '@myself'
created_date: '2026-07-16 05:22'
updated_date: '2026-07-16 05:37'
labels:
  - frontend
  - ssh
  - ux
dependencies: []
ordinal: 39014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
frontend/src/routes/ssh.principals.tsx renders a HostPrincipalCard for every non-offboarded host, stacked down the page. With more than a handful of hosts this is a long scroll and there is no way to go straight to the host you want to configure. Replace the stack with a host list/selector: choose a host, then configure that host's principal-to-account mappings. The principal catalog above stays as-is. Keep the stale/'needs push' signal visible in the list so a host needing a push is findable without clicking through each one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User sees a list of registered hosts on the Principals page rather than every host's mapping form at once
- [x] #2 Selecting a host shows that host's principal-to-account mapping form and rendered auth_principals files
- [x] #3 Hosts needing a push are marked in the list itself, without selecting them one by one
- [x] #4 Mapping a principal and Mark pushed still work for the selected host
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extract HostPrincipalCard from ssh.principals.tsx into components/ssh/HostPrincipalMappingCard.tsx, self-contained (queries principal.list/render/staleHosts by hostId).
2. ssh.principals.tsx: replace the stacked cards with a host list (fqdn + status + stale badge) that selects one host; render the mapping card for the selection only.
3. Auto-select first host; keep catalog above untouched.
4. Typecheck + tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Replaced the stack of per-host cards on /ssh/principals with a two-column host picker: a scrollable host list on the left, the selected host's mapping card on the right.

- Extracted the old inline HostPrincipalCard into components/ssh/HostPrincipalMappingCard.tsx, now self-contained (it queries principal.list / render / staleHosts itself by hostId) so TASK-213 can reuse it on the host detail page. The exported StalePill is shared between the card header and the picker list.
- The list shows fqdn + status + the stale pill per host and a '<n> need a push' / 'All pushed' summary, so a host needing a push is findable without clicking through. Selection falls back to the first host, so the page always shows a form once hosts load.
- The principal catalog above is unchanged. Mapping now also invalidates mappingsByPrincipal and the host deploy bundle, so the reachability panel and the deploy panel's stale banner stay in sync.

Verified in the dev stack (:52080): the list renders 5 seeded hosts with stale pills; selecting bastion-01 and mapping deploy -> deployer rendered /etc/ssh/auth_principals/deployer; Mark pushed cleared the pill in both the card header and the list (5 -> 4 need a push). Frontend typecheck clean, 52 tests pass.
<!-- SECTION:NOTES:END -->
