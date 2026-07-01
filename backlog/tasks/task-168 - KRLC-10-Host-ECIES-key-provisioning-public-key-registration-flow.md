---
id: TASK-168
title: >-
  KRLC-10: Reuse the SSH host key for ECIES + ensure an ecdsa-nistp256 host
  pubkey is registered
status: To Do
assignee: []
created_date: '2026-07-01 07:15'
updated_date: '2026-07-01 07:42'
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
In the default model the client decrypts with the host's EXISTING SSH host key (/etc/ssh/ssh_host_ecdsa_key), so NO separate ECIES keypair is generated. This task makes that path work end-to-end: verify the host has an ecdsa-sha2-nistp256 host key (sshd generates one by default) and that its PUBLIC key is registered with pki-manager - reuse opensshHostPubkey when the host registered with ecdsa, otherwise register /etc/ssh/ssh_host_ecdsa_key.pub via the KRLC-02 path. Provide an OPTIONAL `krl-client keygen` + --host-key override for operators who prefer a DEDICATED ECIES key instead of reusing the SSH host key (documented trade-off; private key 0600, never transmitted). Document the ed25519-only-host fallback (register the ecdsa host pubkey).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A host operator can generate a P-256 ECIES private key locally (0600) and register its public key with the backend in one documented flow; the client then fetches+decrypts its KRL with no KMS access
- [ ] #2 The private key is written 0600 and never leaves the host or appears in logs/argv; re-running keygen does not clobber an existing key without an explicit --force
- [ ] #3 Registration failures (host not found, bad pubkey, feature disabled) surface clear, actionable errors mapped to exit 9
- [ ] #4 An optional dedicated-ECIES-key mode is available via --host-key (key kept 0600, never transmitted) for operators who prefer not to reuse the SSH host key
<!-- AC:END -->
