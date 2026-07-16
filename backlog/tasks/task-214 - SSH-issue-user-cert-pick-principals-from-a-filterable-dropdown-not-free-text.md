---
id: TASK-214
title: 'SSH issue user cert: pick principals from a filterable dropdown, not free text'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-16 05:23'
updated_date: '2026-07-16 05:27'
labels:
  - frontend
  - ssh
  - ux
dependencies: []
ordinal: 41014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In frontend/src/components/SshCapabilityEditor.tsx the principals field is a free-text TagInput ('press Enter'), so issuing a cert on /ssh/users/new means typing principal names from memory. A typo yields a cert that authenticates but is denied login everywhere — the failure PrincipalReachability already warns about after the fact. Replace it with a dropdown listing principals from the catalog (trpc.ssh.principal.list), filtering as the user types, supporting multiple selections. Decide whether a name not in the catalog can still be entered: certs may legitimately carry principals not yet mapped, so free entry probably stays available but should be visibly distinct from a catalog pick.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The principals field offers existing principals from the catalog in a dropdown
- [ ] #2 Typing filters the dropdown to matching principals
- [ ] #3 User can select several principals and remove any of them
- [ ] #4 The existing reachability warning still flags a selected principal that is mapped to no host account
- [ ] #5 Issuing a certificate grants exactly the selected principals
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New components/PrincipalSelect.tsx: pure (catalog passed in) combobox — chips for selections, text filter, dropdown of catalog matches, free entry still allowed but visibly distinct.
2. SshCapabilityEditor takes optional principalCatalog prop and renders PrincipalSelect instead of TagInput (stays trpc-free so its unit tests need no provider).
3. ssh.users.new.tsx feeds trpc.ssh.principal.list into it.
4. Unit tests for filter/select/remove/free-entry; typecheck.
<!-- SECTION:PLAN:END -->
