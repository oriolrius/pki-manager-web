---
id: TASK-153
title: 'SSH-32a: CA rotation: dual-trust overlap and predecessor retirement'
status: To Do
assignee: []
created_date: '2026-06-29 15:45'
labels:
  - ssh-cert-manager
  - automation
milestone: SSH Certificate Manager
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement SSH CA rotation backed by the rotation columns added in SSH-05 (predecessor_ca_id, status 'rotating', retire_after). Provision a successor SSH CA key, mark the predecessor 'rotating', and have getTrustAnchors() emit BOTH keys (two TrustedUserCAKeys lines / two @cert-authority entries) until all certs signed by the old key expire, then retire it. New issuance uses the successor; no valid cert is rejected mid-rotation. Surfaced in the CA detail UI (SSH-26 already shows both keys during rotation). Emits ssh.ca.rotate audit rows.

**Epic:** Automation, Ops, Docs & E2E
**Logical deps:** SSH-05, SSH-10, SSH-21
**Touchpoints:** backend/src/services/ssh-ca.service.ts, backend/src/services/ssh-krl.service.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Rotating an SSH CA keeps the predecessor key trusted (both keys published in the trust bundle) until old certs expire, then retires it, with no valid cert rejected mid-rotation
- [ ] #2 New certificates after rotation are signed by the successor CA; the predecessor signs nothing further
- [ ] #3 The rotation uses the SSH-05 rotation columns (no late schema migration) and the partial unique index permits the active+rotating pair
- [ ] #4 Rotation start and predecessor retirement each write an audit_log row and are reachable from the CA detail UI
<!-- AC:END -->
