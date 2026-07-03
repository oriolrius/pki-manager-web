---
id: TASK-181
title: 'BLK-04: SshBlockService — block/unblock + lifecycle interactions + audit'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-03 21:25'
updated_date: '2026-07-03 22:43'
labels:
  - ssh-host-blocks
  - backend
milestone: SSH Host Access Blocks
dependencies:
  - TASK-180
references:
  - backlog/decisions/decision-016 - Per-Host-User-Access-Blocks-SSH.md
priority: medium
ordinal: 8014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SshBlockService.block(hostId, identityId, reason?) / unblock / listForHost / listForIdentity.

Block and unblock SYNCHRONOUSLY regenerate that host's composed KRL (sub-second server-side; propagation bounded by one pull interval — unblock is symmetric, never faster). Audit rows ssh.host.block / ssh.host.unblock {identityId, hostId, reason} on success and failure.

Shared-fingerprint detection at block time: find other identities whose certs share any pubkey fingerprint with the target (fingerprint KRL entries deny the KEY under any CA — over-block). Returned as warning data for the API/UI confirm.

Lifecycle (per decision-016): blocking a DISABLED identity is allowed (pre-emptive — still denies unexpired certs); identity offboard (SSH-32c) supersedes blocks — rows kept and annotated superseded for the UI; host offboard retires that host's per-host KRL lineage and keeps block rows (moot, retained for audit).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 block/unblock round-trip: active partial-unique enforced; lift keeps the row; re-block after lift works; each mutation synchronously produces a new per-host KRL row with a higher number
- [ ] #2 Audit rows written on success and failure for both operations
- [ ] #3 listForHost/listForIdentity return reason/by/when/status + superseded-by-offboard annotation
- [ ] #4 Shared-fingerprint detection returns colliding identities for the over-block warning
- [ ] #5 Lifecycle tests: disabled identity blockable; identity offboard marks blocks superseded; host offboard retires the lineage and keeps rows
<!-- AC:END -->
