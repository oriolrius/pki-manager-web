---
id: TASK-199
title: >-
  ANS-05: ECIES: provision + register an ecdsa-sha2-nistp256 key so encrypted
  KRL is deployable
status: To Do
assignee: []
created_date: '2026-07-11 09:32'
labels:
  - ansible
  - ansible-integration
  - ecies
  - ssh
milestone: Ansible Integration
dependencies:
  - TASK-195
documentation:
  - backlog/docs/doc-009 - Ansible-Integration-Milestone.md
priority: high
ordinal: 26014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ECIES is P-256-only (ssh-host.service.ts:335-340) and register-host-pubkey re-validates the sign-host-stored pubkey (ssh-external.routes.ts:176-184), so registering the role's ed25519 key 409s ECIES_KEY_UNSUPPORTED. When ssh_host_cert_ecies_enabled, generate an ecdsa-sha2-nistp256 host key on the node and sign THAT via sign-host (so the stored opensshHostPubkey the KRL is encrypted to is the P-256 key krl-client can decrypt with at /etc/ssh/ssh_host_ecdsa_key), then register it. Resolve whether the ecdsa cert becomes the presented host cert or is decrypt-only (see open questions) — pick one and make it consistent with the drop-in from ANS-03.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With ECIES enabled, an ecdsa-sha2-nistp256 key exists at the krl-client default decrypt path and its public key is the one registered with the backend
- [ ] #2 POST /register-host-pubkey returns success (not 409 ECIES_KEY_UNSUPPORTED) for a role-provisioned ECIES host
- [ ] #3 The backend subsequently produces an ECIES-encrypted per-host KRL that decrypts with the host's ecdsa key
- [ ] #4 A second role run reports no change (key not regenerated, registration idempotent)
<!-- AC:END -->
