---
id: TASK-116
title: >-
  SSH-00: Establish SSH milestone base branch, true migration head, and reuse
  inventory
status: To Do
assignee: []
created_date: '2026-06-29 15:37'
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
- [ ] #1 A short decision documents the chosen base branch and lists, per named 'reused' component (raw-signing seam, fleet-token auth, public KRL serving), whether it exists on that base or is authored by this milestone
- [ ] #2 All SSH migration tasks reference 'the next sequential migration after the verified current head' (confirmed against meta/_journal.json), with no hard-coded number; the head is re-verified at branch-cut, not assumed to be 0003
- [ ] #3 The milestone's reuse claims (signRaw-shared-with-CRL, cluster-token-generalisation, /crl-ETag-mirroring) are corrected to match the actual base-branch state before Phase 2 begins
- [ ] #4 No downstream task asserts reuse of code absent on the chosen base
<!-- AC:END -->
