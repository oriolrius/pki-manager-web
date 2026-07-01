---
id: TASK-168
title: 'KRLC-10: Host ECIES key provisioning + public-key registration flow'
status: To Do
assignee: []
created_date: '2026-07-01 07:15'
labels:
  - ssh-cert-manager
  - automation
  - crypto
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-159
  - TASK-160
priority: medium
ordinal: 10
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Provide the host-side provisioning path the local-key model needs: a way to generate/hold the host P-256 ECIES private key locally (e.g. a `krl-client keygen` subcommand writing a 0600 key under /etc/krl-client, or reuse of a supplied EC key) and register the corresponding PUBLIC key with the backend endpoint from KRLC-02, capturing any returned id. Support the end-to-end enable sequence (register host -> issue host cert -> generate host ECIES key -> register its pubkey -> SSH_ECIES_ENABLED=true). The private key stays on the host with strict perms and is never transmitted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A host operator can generate a P-256 ECIES private key locally (0600) and register its public key with the backend in one documented flow; the client then fetches+decrypts its KRL with no KMS access
- [ ] #2 The private key is written 0600 and never leaves the host or appears in logs/argv; re-running keygen does not clobber an existing key without an explicit --force
- [ ] #3 Registration failures (host not found, bad pubkey, feature disabled) surface clear, actionable errors mapped to exit 9
<!-- AC:END -->
