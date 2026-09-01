---
id: TASK-233
title: Redesign SSH KRL management UX
status: In Progress
assignee:
  - '@codex'
created_date: '2026-09-01 09:35'
updated_date: '2026-09-01 09:35'
labels: []
dependencies: []
ordinal: 60014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Improve the /ssh/krl page's information hierarchy and operator workflow without removing any existing KRL features or actions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 KRL status, history, and operational actions are presented in a clear, scannable hierarchy
- [ ] #2 All existing controls and capabilities remain available, including revocation and KRL distribution actions
- [ ] #3 The responsive page provides contextual guidance and clear destructive-action affordances
- [ ] #4 Frontend typecheck, lint, and relevant tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit the existing KRL route, queries, mutations, and related SSH UI conventions.
2. Reorganize the page around an operator workflow: choose CA, assess current state, revoke, generate, then confirm fleet distribution.
3. Preserve every existing mutation and data view while adding responsive layout, explicit loading/empty states, and high-clarity risk guidance.
4. Run frontend typecheck, lint, and relevant tests; review the final diff and record PR-ready notes.
<!-- SECTION:PLAN:END -->
