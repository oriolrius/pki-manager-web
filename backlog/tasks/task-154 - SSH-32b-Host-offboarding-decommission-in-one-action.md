---
id: TASK-154
title: 'SSH-32b: Host offboarding / decommission in one action'
status: To Do
assignee: []
created_date: '2026-06-29 15:46'
updated_date: '2026-06-29 15:48'
labels:
  - ssh-cert-manager
  - automation
milestone: SSH Certificate Manager
dependencies:
  - TASK-130
  - TASK-141
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A single 'decommission host' action that revokes outstanding host certs (feeding the KRL), removes its principal maps, destroys its KMS-registered pubkey object if one exists (ECIES path), and sets ssh_hosts.status 'offboarded'. Emits the right KRL directives and audit rows. Surfaced in the host detail UI.

**Epic:** Automation, Ops, Docs & E2E
**Logical deps:** SSH-12, SSH-21
**Touchpoints:** backend/src/services/ssh-host.service.ts, backend/src/services/ssh-krl.service.ts, frontend/src/routes/ssh.hosts.$id.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decommissioning a host in one action revokes its outstanding certs (feeding the KRL), removes its principal maps, destroys its KMS-registered pubkey object if present, and sets status 'offboarded'
- [ ] #2 An offboarded host can no longer be issued certs and its prior certs are revoked into the KRL
- [ ] #3 The action writes audit_log rows and is reachable from the host detail UI
- [ ] #4 Decommission succeeds even when no KMS pubkey was ever registered (ECIES path disabled)
<!-- AC:END -->
