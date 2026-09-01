---
id: TASK-233
title: Redesign SSH KRL management UX
status: In Progress
assignee:
  - '@codex'
created_date: '2026-09-01 09:35'
updated_date: '2026-09-01 11:34'
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
- [x] #1 KRL status, history, and operational actions are presented in a clear, scannable hierarchy
- [x] #2 All existing controls and capabilities remain available, including revocation and KRL distribution actions
- [x] #3 The responsive page provides contextual guidance and clear destructive-action affordances
- [ ] #4 Frontend typecheck, lint, and relevant tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit the existing KRL route, queries, mutations, and related SSH UI conventions.
2. Replace the upfront CA selector with an operational KRL overview: each available CA shows its own KRL health and exposes an explicit management entry point.
3. Preserve every existing mutation and data view while adding responsive layout, explicit loading/empty states, and high-clarity risk guidance.
4. Run frontend typecheck, lint, and relevant tests; review the final diff and record PR-ready notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Summary

- Rebuilt `/ssh/krl` around the operator sequence: select CA, assess the current KRL, record a revocation, generate an updated KRL, then inspect host-level enforcement.
- Preserved all existing KRL queries and actions (`getLatest`, `listRevocations`, generate, and serial/key/certificate revocation) plus the per-host distribution view.
- Added loading, error, and empty states; responsive mobile cards; clearer endpoint and lifecycle guidance; and a danger-styled, confirmation-gated permanent revocation action.

## Validation

- Passed: `npm run typecheck`
- Passed: `npm run test` (8 files, 57 tests)
- Blocked outside this change: `npm run lint` crashes during ESLint/AJV initialization before linting source (`Cannot set properties of undefined (setting defaultMeta)`).
- Also attempted `npm run build`; it is blocked by existing backend/frontend TypeScript errors outside this route.

## Follow-up UX refinement

- Replaced the upfront CA dropdown with a per-CA KRL overview. Operators now see the operational state for each available CA before choosing “Manage this KRL.”
- The CA is still visible when required for the underlying per-CA revocation model, but it is no longer the page’s first decision.
- Re-ran `npm run typecheck` successfully after the refinement; the existing ESLint initialization blocker remains unchanged.
<!-- SECTION:NOTES:END -->
