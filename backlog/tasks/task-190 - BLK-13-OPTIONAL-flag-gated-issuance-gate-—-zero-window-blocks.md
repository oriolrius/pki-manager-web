---
id: TASK-190
title: 'BLK-13: OPTIONAL flag-gated issuance gate — zero-window blocks'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-03 21:27'
updated_date: '2026-07-03 23:28'
labels:
  - ssh-host-blocks
  - backend
milestone: SSH Host Access Blocks
dependencies:
  - TASK-181
  - TASK-182
references:
  - backlog/decisions/decision-016 - Per-Host-User-Access-Blocks-SSH.md
priority: low
ordinal: 17014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Optional hardening from decision-016 (adopted from losing option C; priced separately; ship ONLY after the pure per-host-KRL model works end-to-end).

Pure per-host KRLs leave one recurring window: a blocked identity that retains issuance rights can rotate keys -> new cert -> connect to the blocked host inside the <=15-min pull gap; and a host that NEVER pulls never enforces. The gate closes both BY CONSTRUCTION: an unconditional check in SshCertService.sign (type=user) strips/denies any principal resolving to a blocked host — every post-block cert is BORN unable to authenticate there, bounding even a dead host by the residual TTL (<=1w).

Cost (why it is flag-gated, default OFF): render() must pre-provision dual P + P@<fqdn> auth_principals lines, the fleet re-pushed once, and narrowed certs surface in the UI. The two mechanisms are independent layers — either enforces alone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Flag ON: a cert issued to a blocked identity carries no principal resolving to the blocked host, on ALL issuance paths; flag OFF: zero behavior change
- [ ] #2 render() emits dual-form principal lines; markPushed/drift flows intact; the one-time fleet re-push documented
- [ ] #3 Narrowed certs surfaced in the UI; E2E: post-block cert denied on the blocked host within TTL even with a never-pulling host
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. render(): dual P + P@<fqdn> lines (unconditional pre-provisioning)
2. SshCertService.sign: SSH_BLOCK_ISSUANCE_GATE narrowing via the single choke point; empty-result guard; audit detail
3. Unit tests (flag off = zero change, narrowing, all-blocked error, renew path, render dual lines)
4. E2E: post-block cert denied on never-pulling blocked host, allowed elsewhere
5. Document flag + one-time re-push (runbook/env)
<!-- SECTION:PLAN:END -->
