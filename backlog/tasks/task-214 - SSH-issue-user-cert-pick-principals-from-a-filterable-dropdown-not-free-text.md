---
id: TASK-214
title: 'SSH issue user cert: pick principals from a filterable dropdown, not free text'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-16 05:23'
updated_date: '2026-07-16 05:37'
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
- [x] #1 The principals field offers existing principals from the catalog in a dropdown
- [x] #2 Typing filters the dropdown to matching principals
- [x] #3 User can select several principals and remove any of them
- [x] #4 The existing reachability warning still flags a selected principal that is mapped to no host account
- [x] #5 Issuing a certificate grants exactly the selected principals
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New components/PrincipalSelect.tsx: pure (catalog passed in) combobox — chips for selections, text filter, dropdown of catalog matches, free entry still allowed but visibly distinct.
2. SshCapabilityEditor takes optional principalCatalog prop and renders PrincipalSelect instead of TagInput (stays trpc-free so its unit tests need no provider).
3. ssh.users.new.tsx feeds trpc.ssh.principal.list into it.
4. Unit tests for filter/select/remove/free-entry; typecheck.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Replaced the free-text TagInput for principals on /ssh/users/new with a new filterable combobox, components/PrincipalSelect.tsx.

Decision on off-catalog names: free entry stays (a cert may legitimately carry a principal not yet mapped) but is visibly distinct — catalog picks render as normal primary chips, off-catalog picks as dashed amber chips with a marker icon and a 'not in the catalog' tooltip, and adding one takes a deliberate click on a separate 'Use "x" — not in the catalog' row. So a typo is visible at issue time rather than only after the fact via PrincipalReachability.

PrincipalSelect takes its options as a prop and does no fetching, so SshCapabilityEditor stays trpc-free and its existing unit tests need no provider; the editor gained an optional principalCatalog prop and ssh.users.new.tsx feeds it trpc.ssh.principal.list. Enter takes the single filtered match, Backspace on an empty input drops the last chip, Escape closes. TagInput is untouched and still used by the host register form.

Verified in the dev stack (:52080): the dropdown lists the seeded catalog; typing 'd' narrows it to deploy/dba/webadmin; selecting deploy plus a free-typed 'typo-role' produced two chips with only the latter marked, and PrincipalReachability still warned it maps to no host account. Issued a real cert for identity dave with only 'deploy' selected — ssh-keygen -L on the returned blob reports Principals: deploy exactly. 7 new unit tests in PrincipalSelect.test.tsx (filter, multi-select, remove, no re-offer of a selection, Enter-takes-match, off-catalog entry + marking); frontend typecheck clean, 52 tests pass.
<!-- SECTION:NOTES:END -->
