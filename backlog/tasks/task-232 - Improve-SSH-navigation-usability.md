---
id: TASK-232
title: Improve SSH navigation usability
status: In Progress
assignee:
  - '@codex'
created_date: '2026-09-01 09:20'
updated_date: '2026-09-01 09:20'
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
- [ ] #1 SSH workspace navigation groups related operator workflows into a clear, scannable structure
- [ ] #2 The current SSH route, active state, and selected zone remain clear while navigating
- [ ] #3 The revised navigation is usable at desktop and narrow viewport widths
- [ ] #4 Existing SSH routes remain reachable with their zone context preserved
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inspect the application shell, SSH section routes, and current navigation states
2. Design a workflow-oriented SSH navigation model that preserves routes and zone context
3. Implement responsive navigation and active-state improvements
4. Run focused frontend checks and verify desktop and narrow viewport behavior
<!-- SECTION:PLAN:END -->
