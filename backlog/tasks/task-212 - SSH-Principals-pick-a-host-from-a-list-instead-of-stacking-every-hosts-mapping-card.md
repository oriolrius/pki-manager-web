---
id: TASK-212
title: >-
  SSH Principals: pick a host from a list instead of stacking every host's
  mapping card
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-16 05:22'
updated_date: '2026-07-16 05:26'
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
- [ ] #1 User sees a list of registered hosts on the Principals page rather than every host's mapping form at once
- [ ] #2 Selecting a host shows that host's principal-to-account mapping form and rendered auth_principals files
- [ ] #3 Hosts needing a push are marked in the list itself, without selecting them one by one
- [ ] #4 Mapping a principal and Mark pushed still work for the selected host
<!-- AC:END -->
