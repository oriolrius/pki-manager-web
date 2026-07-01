---
id: TASK-168
title: >-
  KRLC-10: Reuse the SSH host key for ECIES + ensure an ecdsa-nistp256 host
  pubkey is registered
status: To Do
assignee: []
created_date: '2026-07-01 07:15'
updated_date: '2026-07-01 07:44'
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
- [ ] #1 A host with an ecdsa-sha2-nistp256 host key whose public key is registered fetches+decrypts its KRL using only /etc/ssh/ssh_host_ecdsa_key - no dedicated-key generation and no KMS access
- [ ] #2 For a host without a registered P-256 public key, onboarding surfaces a clear, actionable step (register /etc/ssh/ssh_host_ecdsa_key.pub) instead of a cryptic decrypt failure
- [ ] #3 An optional dedicated-ECIES-key mode is available via --host-key (key kept 0600, never transmitted) for operators who prefer not to reuse the SSH host key
<!-- AC:END -->
