---
id: TASK-116
title: >-
  SSH-00: Establish SSH milestone base branch, true migration head, and reuse
  inventory
status: Done
assignee:
  - '@myself'
created_date: '2026-06-29 15:37'
updated_date: '2026-06-29 17:22'
labels:
  - ssh-cert-manager
  - crypto
  - backend
milestone: SSH Certificate Manager
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the base branch a first-class, verified precondition before any SSH code is specified concretely. This worktree (ssh-cert-manager @3f95581) has NO cluster/external-issuer machinery (no clusters table, cluster.service.ts, cluster-auth, external.routes.ts), NO CRL-signing seam (crl.service.ts:155 is `const crlPem=''`, server.ts:165-167 returns 503), NO decision-010, and migration head is 0003. Decide and document the base branch: either build SSH on this branch (authoring the signing seam and fleet-token stack from scratch) or rebase/merge onto a branch that already carries the cluster machinery — but in EITHER case re-derive the migration head from meta/_journal.json at integration time. Produce a reuse inventory stating, for every 'reused' component the design names (signRaw, cluster token model, public /crl serving), whether it EXISTS on the chosen base or must be built by this milestone.

**Epic:** SSH Crypto Core & Baseline
**Logical deps:** none
**Touchpoints:** backend/src/db/migrations/meta/_journal.json, backlog/decisions/decision-014 - SSH-Milestone-Base-Branch-and-Reuse-Inventory.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A short decision documents the chosen base branch and lists, per named 'reused' component (raw-signing seam, fleet-token auth, public KRL serving), whether it exists on that base or is authored by this milestone
- [x] #2 All SSH migration tasks reference 'the next sequential migration after the verified current head' (confirmed against meta/_journal.json), with no hard-coded number; the head is re-verified at branch-cut, not assumed to be 0003
- [x] #3 The milestone's reuse claims (signRaw-shared-with-CRL, cluster-token-generalisation, /crl-ETag-mirroring) are corrected to match the actual base-branch state before Phase 2 begins
- [x] #4 No downstream task asserts reuse of code absent on the chosen base
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified base branch = ssh-cert-manager @3f95581 (descends from origin/main). Migration head = 0003_restore_key_algorithm in backend/src/db/migrations/meta/_journal.json -> first SSH migration is 0004 (SSH migration tasks reference "next after the verified head", never hard-coded). Reuse inventory verified by grep/ls and recorded in decision-014: signRaw ABSENT (authored by SSH-03), crl.service.ts:156 still `const crlPem = ''` placeholder, NO clusters table / cluster.service.ts / external.routes.ts (SSH-19 builds the fleet-token stack from scratch), /crl route has no ETag/304/lazy-regen (SSH-22 authors that). Milestone reuse claims already corrected in the finalized tasks (SSH-03/19/22 framed as authoring, not reuse). Decision: decision-014 (Accepted).
<!-- SECTION:NOTES:END -->
