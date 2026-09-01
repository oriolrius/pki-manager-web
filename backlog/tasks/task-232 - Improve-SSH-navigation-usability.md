---
id: TASK-232
title: Improve SSH navigation usability
status: Done
assignee:
  - '@codex'
created_date: '2026-09-01 09:20'
updated_date: '2026-09-01 09:27'
labels:
  - frontend
  - ux
  - ssh
dependencies: []
ordinal: 59014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rework the SSH workspace navigation and its relationship to the application shell so operators can move through SSH CA, access, host, user, revocation, and zone workflows without a crowded or ambiguous submenu.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 SSH workspace navigation groups related operator workflows into a clear, scannable structure
- [x] #2 The current SSH route, active state, and selected zone remain clear while navigating
- [x] #3 The revised navigation is usable at desktop and narrow viewport widths
- [x] #4 Existing SSH routes remain reachable with their zone context preserved
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inspect the application shell, SSH section routes, and current navigation states
2. Design a workflow-oriented SSH navigation model that preserves routes and zone context
3. Implement responsive navigation and active-state improvements
4. Run focused frontend checks and verify desktop and narrow viewport behavior
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reworked navigation around operator workflows instead of flat route lists.

- Consolidated the global header into Dashboard, PKI, SSH, and Operations, with responsive disclosure menus and a mobile navigation panel.
- Replaced the SSH tab strip with Overview plus Trust, Access, Security, and Administration groups; narrow screens use a labeled section selector.
- Preserved active states and zone context through SSH workspace navigation and the global SSH entry.
- Improved the SSH context header and zone selector for narrow screens.

Verification:
- npm run typecheck
- npm test (57 tests passed)
- Playwright desktop/mobile navigation checks: no horizontal overflow, only one disclosure menu opens at once, and ?zone=default persists when navigating to SSH hosts.
- git diff --check

Note: npm run lint remains blocked before source linting by the repository AJV/ESLint dependency error (Cannot set properties of undefined: defaultMeta).
<!-- SECTION:NOTES:END -->
