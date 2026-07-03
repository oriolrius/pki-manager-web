---
id: TASK-191
title: Restore clean backend typecheck baseline + gate it in CI
status: To Do
assignee: []
created_date: '2026-07-03 21:53'
labels:
  - ci
  - tech-debt
  - backend
dependencies: []
priority: high
ordinal: 18014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pre-milestone chore requested before starting BLK-02 (SSH Host Access Blocks): pnpm typecheck fails with 119 pre-existing errors in the BACKEND workspace across 23 files (frontend is clean, 0 errors). Root cause of accumulation: the CI typecheck job in .github/workflows/test.yml runs ONLY the frontend typecheck (working-directory ./frontend), so backend debt was never gated.

Error profile: mostly TS6133 unused imports/vars (mechanical removals), TS2345 CreateFastifyContextOptions mismatches in tRPC test files, TS7022/TS7024 Drizzle self-referential inference in db/schema.ts, TS2322 null-vs-undefined in crl.service.ts, TS18046 unknown in auth.test.ts.

Constraints: ZERO behavior change — type-level and dead-code removals only; full backend test suite (505 passing) must stay green. Extend the CI typecheck job to cover both workspaces (root pnpm typecheck) so the debt cannot re-accumulate.

Note: distinct from TASK-104 (Done, v1.5.1-era lockfile + TS7030 fixes); this is debt accumulated since.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm typecheck passes with 0 errors in both workspaces
- [ ] #2 Backend test suite fully green after the fixes (no behavior change)
- [ ] #3 CI test.yml typecheck job gates backend + frontend (root pnpm typecheck)
<!-- AC:END -->
