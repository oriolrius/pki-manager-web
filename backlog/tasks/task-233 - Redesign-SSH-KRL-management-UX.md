---
id: TASK-233
title: Redesign SSH KRL management UX
status: In Progress
assignee:
  - '@codex'
created_date: '2026-09-01 09:35'
updated_date: '2026-09-01 11:39'
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
- [x] #2 The responsive page provides contextual guidance and clear destructive-action affordances
- [ ] #3 Frontend typecheck, lint, and relevant tests pass
- [x] #4 Only User CAs are available for KRL management; host-specific KRL management and distribution monitoring are excluded from this page
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Audit the existing KRL route, queries, mutations, and related SSH UI conventions.
2. Reorient `/ssh/krl` around user-certificate revocation: list only User CAs and remove host-specific KRL management and distribution monitoring from this page.
3. Preserve the user-revocation lifecycle while adding focused loading, error, empty, and destructive-action states.
4. Run frontend typecheck, lint, and relevant tests; review the final diff and record PR-ready notes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Summary

- Reframed `/ssh/krl` as a focused emergency user-certificate revocation workflow.
- The overview lists only User CAs, with the current user revocation-list version, revocation count, and expiry; operators open a User CA only when they need to manage its list.
- Removed Host CA KRL management and per-host distribution monitoring from this route. Host-specific access-block delivery remains in the user/host access workflows where it can be acted on.
- Preserved User CA KRL generation, serial/key/certificate revocation, revocation history, endpoint visibility, responsive states, and confirmation before irreversible revocation.

## Validation

- Passed: `npm run typecheck`
- Passed: `npm run test` (8 files, 57 tests)
- Blocked outside this change: `npm run lint` crashes during ESLint/AJV initialization before linting source (`Cannot set properties of undefined (setting defaultMeta)`).
- Also attempted `npm run build`; it is blocked by existing backend/frontend TypeScript errors outside this route.
<!-- SECTION:NOTES:END -->
