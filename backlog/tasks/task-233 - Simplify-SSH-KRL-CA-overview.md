---
id: TASK-233
title: Simplify SSH KRL CA overview
status: In Progress
assignee:
  - '@codex'
created_date: '2026-09-01 14:12'
updated_date: '2026-09-01 14:14'
labels: []
dependencies: []
ordinal: 60014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Present KRL capabilities as separate, compact User CA and Host CA lists while retaining the existing per-CA KRL management functions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User CAs and Host CAs are shown in separate simple KRL lists
- [x] #2 Each CA list entry exposes its current KRL state and opens the existing management functions
- [x] #3 KRL generation, all revocation modes, revocation history, and host distribution remain available
- [ ] #4 Frontend typecheck, lint, and relevant tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Review the restored KRL route and retain every existing query and mutation.
2. Replace the upfront CA selector with separate compact User CA and Host CA KRL lists.
3. Route each list entry into the existing per-CA management view, retaining generation, revocation, history, and distribution functionality.
4. Run focused frontend validation and document the result.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Summary

- Replaced the CA selector with two compact lists: User CA KRLs and Host CA KRLs.
- Each CA row shows its current KRL version, revocation count, and expiry (or an explicit empty/loading/error state), with one Manage action.
- Manage opens the original per-CA KRL functions: generate, revoke by serial/key/certificate, revocation history, and published endpoint details.
- Kept the per-host distribution table unchanged below the lists.

## Validation

- Passed: `npm run typecheck`
- Passed: `npm run test` (8 files, 57 tests)
- Blocked outside this change: `npm run lint` crashes during ESLint/AJV initialization before linting source (`Cannot set properties of undefined (setting defaultMeta)`).
<!-- SECTION:NOTES:END -->
