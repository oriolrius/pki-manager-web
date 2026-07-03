---
id: TASK-178
title: >-
  BLK-01: Stamp last_krl_fetch_at on ECIES 304 responses (pinned req #5,
  pre-existing bug)
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-03 21:24'
updated_date: '2026-07-03 22:29'
labels:
  - ssh-host-blocks
  - backend
  - telemetry
milestone: SSH Host Access Blocks
dependencies: []
references:
  - backend/src/rest/routes/ssh-external.routes.ts
priority: medium
ordinal: 5014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Standalone pre-existing bug fix, shippable immediately and independently of the rest of the milestone: the ECIES POST /api/v1/external/ssh/krl stamps last_krl_fetch_at only on the 200 branch (ssh-external.routes.ts:230); the 304 branch (:214-217) does not — while KRLs regenerate hourly, so a healthy 15-min conditional puller reads as stale between regens. Stamp the fetch timestamp on 304 too.
Everything downstream (BLK-07 state pills, stalePullingHosts in ssh-mon.service.ts:54-58) is only trustworthy once this lands. Lands BEFORE BLK-06, which rewrites the same route (merge coordination).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ECIES 304 branch stamps last_krl_fetch_at; 200 behavior unchanged (contract test for both branches)
- [ ] #2 Test: a conditional fetch returning 304 refreshes the timestamp; a healthy 304-only puller is no longer flagged by stalePullingHosts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Stamp last_krl_fetch_at (NOT last_krl_version) on the 304 branch of POST /api/v1/external/ssh/krl
2. Contract tests: 304 refreshes timestamp, 200 behavior unchanged
3. Test stalePullingHosts no longer flags a healthy 304-only puller
<!-- SECTION:PLAN:END -->
