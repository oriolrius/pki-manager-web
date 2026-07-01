---
id: TASK-160
title: >-
  KRLC-02: Backend - encrypt per-host KRL to the host's existing ECDSA host
  pubkey + pin the ECIES envelope
status: To Do
assignee: []
created_date: '2026-07-01 07:14'
updated_date: '2026-07-01 07:44'
labels:
  - ssh-cert-manager
  - backend
  - kms
  - revocation
milestone: SSH KRL Client Distribution
dependencies: []
priority: high
ordinal: 2
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enable local-key decryption by REUSING THE HOST'S EXISTING SSH HOST KEYPAIR as the ECIES keypair (matching pki-manager's canonical HostKey path /etc/ssh/ssh_host_ecdsa_key), so no new key material or host-side keygen is introduced. Change the backend so POST /api/v1/external/ssh/krl encrypts the payload to the host's ALREADY-REGISTERED ECDSA (nistp256) public key (ssh_hosts.opensshHostPubkey when the host key is ecdsa-sha2-nistp256), instead of a KMS-generated ECIES key; the host then decrypts with its local /etc/ssh/ssh_host_ecdsa_key. For hosts whose issued cert uses an ed25519 key, accept/register the host's ecdsa host public key (/etc/ssh/ssh_host_ecdsa_key.pub) for the ECIES path - P-256 is required, ed25519 keys cannot do P-256 ECIES. Define and PIN a standard, documented ECIES envelope (P-256 + HKDF-SHA256 + AES-256-GCM; framing ephemeral-pubkey || nonce || ciphertext || tag) as the interop contract the Go client implements, mirroring how SSH-04/TASK-121 pinned the detached-signature format. Document the SSH-host-key-reuse trade-off and offer a dedicated-key override. Keep the KMS-resident path intact behind its flag; write audit_log rows for registration and every encrypted KRL fetch (success and failure).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST /api/v1/external/ssh/krl for an ecdsa-sha2-nistp256 host encrypts to that host's ALREADY-REGISTERED opensshHostPubkey; the ciphertext decrypts with the host's local /etc/ssh/ssh_host_ecdsa_key with NO new key material or registration step
- [ ] #2 The ECIES envelope (P-256, HKDF-SHA256, AES-256-GCM, framing ephemeral-pubkey||nonce||ciphertext||tag) is specified in a checked-in wire-format doc and covered by an encrypt->decrypt vector test, independent of Cosmian's opaque ECIES
- [ ] #3 A host whose registered key is ed25519 (no P-256) is handled explicitly - it can register its ecdsa host pubkey for the ECIES path, else the fetch returns a clear NOT_PROVISIONED error; registration and each KRL fetch write an audit_log row
<!-- AC:END -->
