---
id: TASK-155
title: 'SSH-32c: User/identity offboarding (disable) in one action'
status: Done
assignee: []
created_date: '2026-06-29 15:46'
updated_date: '2026-06-29 18:39'
labels:
  - ssh-cert-manager
  - automation
milestone: SSH Certificate Manager
dependencies:
  - TASK-131
  - TASK-141
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A single 'disable identity' action that revokes outstanding user certs (feeding the KRL) and disables the identity so no new certs can be issued against it. Emits KRL directives and audit rows. Surfaced in the user detail UI.

**Epic:** Automation, Ops, Docs & E2E
**Logical deps:** SSH-13, SSH-21
**Touchpoints:** backend/src/services/ssh-user.service.ts, backend/src/services/ssh-krl.service.ts, frontend/src/routes/ssh.users.$id.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Disabling an identity in one action revokes its outstanding user certs (feeding the KRL) and prevents new issuance against it
- [x] #2 A disabled identity cannot be selected for new cert issuance in the UI or API
- [x] #3 The action writes audit_log rows and is reachable from the user detail UI
- [x] #4 Re-enabling (if supported) is explicit and audited, otherwise disabling is documented as terminal
<!-- AC:END -->
