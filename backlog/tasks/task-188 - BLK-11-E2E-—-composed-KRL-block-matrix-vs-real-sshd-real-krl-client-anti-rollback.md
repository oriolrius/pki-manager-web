---
id: TASK-188
title: >-
  BLK-11: E2E — composed-KRL block matrix vs real sshd + real krl-client
  anti-rollback
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-03 21:27'
updated_date: '2026-07-03 23:25'
labels:
  - ssh-host-blocks
  - backend
  - e2e
milestone: SSH Host Access Blocks
dependencies:
  - TASK-181
  - TASK-182
  - TASK-183
  - TASK-187
references:
  - backend/src/crypto/ssh/e2e.test.ts
priority: high
ordinal: 15014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the SSH-33 harness (backend/src/crypto/ssh/e2e.test.ts — drives real sshd via direct RevokedKeys installs, gated on KMS_AVAILABLE) AND exercise the real client-side acceptance logic: the harness alone CANNOT prove pinned req #4, because anti-rollback lives in krl-client payload.Validate (payload.go:120-124) — a test that only asserts DB numbers gives false confidence on the exact cutover failure mode (the CLIENT refusing the KRL).

Scenarios:
1. blocked-on-Y: composed KRL installed on Y denies the blocked identity's cert AND its raw key (fingerprint entry).
2. allowed-on-Z: at the same instant, host Z (no block) accepts the same cert.
3. composition coverage: a revoked HOST cert entry survives composition (pinned req #2) and a revoked-but-UNBLOCKED user cert is denied via the per-host KRL (the bonus fix) — a composition bug dropping either union member must fail the suite.
4. lineage-switch (req #4): real krl-client binary — or a Go test in krl-client/internal/payload fed backend-produced ECIES payloads — with installed per-CA number N: accepts first per-host number > N; rejects equal/lower; rejects unsigned payload without --allow-unsigned.
5. reissue-regen: new cert issued to a blocked identity -> regen -> denied on Y.
6. unblock: lift -> regen -> identity accepted on Y again (symmetry).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All six scenarios green under the existing KMS_AVAILABLE gating (skip semantics preserved)
- [x] #2 Lineage-switch exercised against real krl-client validation code (binary or Go payload test), not DB assertions
- [x] #3 Composition-coverage assertions decode the served blob; ssh-keygen -Q cross-check where available
<!-- AC:END -->
