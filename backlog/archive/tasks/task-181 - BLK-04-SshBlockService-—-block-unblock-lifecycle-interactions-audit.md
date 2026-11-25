---
id: TASK-181
title: 'BLK-04: SshBlockService — block/unblock + lifecycle interactions + audit'
status: Done
assignee:
  - '@myself'
created_date: '2026-07-03 21:25'
updated_date: '2026-07-03 22:46'
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
- [x] #1 block/unblock round-trip: active partial-unique enforced; lift keeps the row; re-block after lift works; each mutation synchronously produces a new per-host KRL row with a higher number
- [x] #2 Audit rows written on success and failure for both operations
- [x] #3 listForHost/listForIdentity return reason/by/when/status + superseded-by-offboard annotation
- [x] #4 Shared-fingerprint detection returns colliding identities for the over-block warning
- [x] #5 Lifecycle tests: disabled identity blockable; identity offboard marks blocks superseded; host offboard retires the lineage and keeps rows
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add ssh.host.block/ssh.host.unblock AuditOperations
2. ssh-block.service.ts: block/unblock (sync regen, friendly dup error), listForHost/listForIdentity with superseded-by-offboard annotation, shared-fingerprint detection
3. Guard SshHostKrlService.generate against offboarded hosts (lineage retirement)
4. Tests: round-trip + numbering, audit success/failure, list annotations, fingerprint collision, lifecycle (disabled/identity-offboard/host-offboard)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New src/services/ssh-block.service.ts: block/unblock/listForHost/listForIdentity/sharedKeyCollisions. Both mutations sync-regen via SshHostKrlService.generate (caught + logged on failure, krl:null in result; generate audits its own failure). Audit ssh.host.block / ssh.host.unblock {identityId,hostId,reason} success+failure (AuditOperation extended). Lists join subject/fqdn and derive supersededByOffboard = identity disabled AND no active unexpired cert (SSH-32c global revocation covers every host). Blocks on offboarded hosts rejected (could never be enforced); SshHostKrlService.generate now refuses offboarded hosts (lineage retirement). Tests 7/7 (KMS mocked): round-trip with strictly increasing krlNumbers + blockCount, dup->friendly error, audit rows both ops/both statuses, collision warning (alice/carol shared key), lists, disabled blockable, identity offboard flips annotation without deleting rows, host offboard retires lineage + keeps rows + rejects new blocks. Strict typecheck clean.
<!-- SECTION:NOTES:END -->
