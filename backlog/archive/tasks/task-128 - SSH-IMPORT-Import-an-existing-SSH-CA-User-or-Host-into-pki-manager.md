---
id: TASK-128
title: 'SSH-IMPORT: Import an existing SSH CA (User or Host) into pki-manager'
status: Done
assignee: []
created_date: '2026-06-29 15:41'
updated_date: '2026-06-29 18:03'
labels:
  - ssh-cert-manager
  - backend
  - services
milestone: SSH Certificate Manager
dependencies:
  - TASK-127
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The PoC explicitly supports adopting an existing CA (`cosmian kms ec keys import`); real adopters already have an SSH CA they cannot regenerate without re-trusting the whole fleet. Add an import path to ssh-ca.service: accept an existing EC private key into KMS (or register an already-KMS-resident key id) plus its OpenSSH public key, populate an ssh_cas row, and verify a cert signed with it validates against the published trust anchor. Honours the same exportability posture decided in SSH-SENS.

**Epic:** SSH CA & Signing Services
**Logical deps:** SSH-10
**Touchpoints:** backend/src/services/ssh-ca.service.ts, backend/src/kms/service.ts, backend/src/services/ssh-ca.service.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An operator can adopt an existing EC CA private key (imported into KMS or already KMS-resident) plus its OpenSSH public key into ssh_cas without regenerating the key
- [x] #2 A cert signed with the imported CA validates against the published trust anchor (sshd/known_hosts via @cert-authority or TrustedUserCAKeys)
- [x] #3 No fleet re-trust is required to adopt the existing CA; import writes an ssh.ca.import audit row
- [x] #4 Import enforces ECDSA-P256 and the same sensitive/exportable posture as create()
<!-- AC:END -->
