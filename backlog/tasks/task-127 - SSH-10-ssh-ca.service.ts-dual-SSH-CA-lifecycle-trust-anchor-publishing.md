---
id: TASK-127
title: 'SSH-10: ssh-ca.service.ts: dual SSH CA lifecycle + trust-anchor publishing'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-06-29 15:41'
updated_date: '2026-06-29 17:55'
labels:
  - ssh-cert-manager
  - backend
  - services
milestone: SSH Certificate Manager
dependencies:
  - TASK-119
  - TASK-120
  - TASK-122
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Singleton getSshCaService() class (ctx,params) managing the dual CA. create() calls kmsService.createKeyPair with the key-creation flags chosen by SSH-SENS (sensitive/non-exportable preferred), exports/derives the SPKI public key, converts to the OpenSSH 'ecdsa-sha2-nistp256 AAAA...' line, persists an ssh_cas row, and audits ssh.ca.create. Enforces ECDSA-P256 only (rejects Ed25519/P-384 with a clear PKCS#11-v2.40 message). Provides list/get and getTrustAnchors() returning the User CA TrustedUserCAKeys line and the Host CA @cert-authority line — and, when a predecessor CA is in 'rotating' state, BOTH keys (two lines) so no valid cert is rejected mid-rotation. No X.509 cert is produced.

**Epic:** SSH CA & Signing Services
**Logical deps:** SSH-02, SSH-03, SSH-05
**Touchpoints:** backend/src/services/ssh-ca.service.ts, backend/src/crypto/ssh/pubkey.ts, backend/src/services/ssh-ca.service.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can create a User CA and a Host CA, both ECDSA nistp256 and distinct keypairs; private keys are created with the SSH-SENS-chosen exportability flags and stay in KMS
- [ ] #2 get()/getTrustAnchors() return each CA's OpenSSH public key, SHA256 fingerprint, and ready-to-paste TrustedUserCAKeys / @cert-authority snippets; pasting them makes a real sshd/known_hosts trust certs signed by them; during rotation both predecessor and successor keys are emitted
- [ ] #3 Creating an Ed25519 or P-384 SSH CA is rejected before any KMS call with a clear incompatibility message
- [ ] #4 Every create/revoke writes an audit_log row and ssh_cas records carry no X.509 fields
<!-- AC:END -->
