---
id: TASK-211
title: 'SSH nav: move Principals tab to sit right after Certificate Authorities'
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
ordinal: 38014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The SSH sub-nav order in frontend/src/routes/ssh.tsx (SUB_NAV) is currently: Certificate Authorities, Hosts, Users, Principals, KRL. Principals should come immediately after Certificate Authorities, since principals are the vocabulary that host and user config both reference. SUB_NAV also drives the landing-page card grid, so both update together.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The SSH sub-nav renders tabs in the order: Certificate Authorities, Principals, Hosts, Users, KRL
- [x] #2 The SSH landing page card grid reflects the same order
- [x] #3 Every tab still navigates to its route and shows the active style on the current page
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reorder SUB_NAV in frontend/src/routes/ssh.tsx to CAs, Principals, Hosts, Users, KRL.
2. Verify landing card grid (driven by same const) follows.
3. Typecheck + lint.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reordered SUB_NAV in frontend/src/routes/ssh.tsx to: Certificate Authorities, Principals, Hosts, Users, KRL. SUB_NAV drives both the sub-nav tab bar and the landing card grid, so one edit covers both; activeProps styling and routing are untouched.

Verified in the dev stack (:52080) via orca eval on /ssh: the anchors render in the order cas, principals, hosts, users, krl in both the tab bar and the card grid, each pointing at its own route, with Principals showing the active style while on /ssh/principals.
<!-- SECTION:NOTES:END -->
