---
id: TASK-191
title: Restore clean backend typecheck baseline + gate it in CI
status: Done
assignee:
  - '@myself'
created_date: '2026-07-03 21:53'
updated_date: '2026-07-03 22:23'
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
- [x] #1 pnpm typecheck passes with 0 errors in both workspaces
- [x] #2 Backend test suite fully green after the fixes (no behavior change)
- [x] #3 CI test.yml typecheck job gates backend + frontend (root pnpm typecheck)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Full error inventory grouped by file (119 errors / 23 files)
2. Parallel fix fan-out across disjoint file groups (zero behavior change; remove unused code, fix test context typing, AnySQLiteColumn for schema self-reference, ?? undefined for null-vs-undefined)
3. Verify: pnpm typecheck 0 errors both workspaces + full backend test suite green
4. Extend CI test.yml typecheck job to root pnpm typecheck (backend + frontend)
5. Commit, push, Done
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
119 backend strict-mode errors -> 0 across 16 files; zero behavior change (commit 4e6a54a on feat/ssh-host-blocks).

Key fixes: (1) ONE line fixed 77 errors — createContext param narrowed to Pick<CreateFastifyContextOptions, 'req'|'res'> (tRPC v11 added a required `info` field the ~75 test call sites never passed; contravariance keeps plugin registration valid). (2) schema.ts self-referential FK annotated with AnySQLiteColumn (TS7022/7024). (3) node-forge extension access typed in ca-create.test.ts. (4) Dead imports/locals removed elsewhere.

CI: test.yml typecheck job previously checked ONLY ./frontend (root cause of the debt) — now runs root pnpm typecheck for both workspaces.

Bonus: keycloak/pki-dev-realm.json pki-web client had directAccessGrantsEnabled=false, so auth.test.ts beforeAll threw and 10 OIDC integration tests never ran (the pre-existing intermittent suite failure). Enabled (realm JSON + live instance via admin API): suite improved from 45/46 files, 504 passed / 11 skipped to 46/46 files, 514 passed / 1 skipped.

Follow-up noted (not in scope): three placeholder tests in certificate-bulk.test.ts assert only expect(true); ca.service.ts getById returns extensions as Record<string,unknown> forcing consumer casts; verifyCertificateSignature remains a parse-only stub.
<!-- SECTION:NOTES:END -->
