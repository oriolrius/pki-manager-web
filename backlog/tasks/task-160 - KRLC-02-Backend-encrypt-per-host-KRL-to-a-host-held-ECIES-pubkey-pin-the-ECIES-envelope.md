---
id: TASK-160
title: >-
  KRLC-02: Rebuild per-host KRL encryption for LOCAL host decryption (retire
  KMS-resident ECIES)
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 08:05'
labels:
  - ssh-cert-manager
  - backend
  - kms
  - revocation
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-173
priority: high
ordinal: 2
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rebuild the SSH-24 encrypted KRL distribution so decryption is ALWAYS local on the host and the KMS is NEVER involved in en/decrypting the KRL. Replace the current KMS-resident model (registerHostEciesKey -> KMIP CreateKeyPair inside the KMS; POST /api/v1/external/ssh/krl -> KMIP Encrypt to ssh_hosts.kms_pubkey_id; host decrypts by CALLING the KMS) with a NATIVE backend implementation (node:crypto) that encrypts the payload to the host's OWN public key: by default the host's already-registered ECDSA nistp256 SSH host public key (ssh_hosts.opensshHostPubkey), or a host-supplied dedicated ECIES pubkey. Pin a standard, cross-implementation ECIES envelope (P-256 + HKDF-SHA256 + AES-256-GCM; framing ephemeral-pubkey || nonce || ciphertext || tag) as the interop contract the Go client implements. Remove the KMS Encrypt/Decrypt/CreateKeyPair calls from this path, drop/repurpose ssh_hosts.kms_pubkey_id, and migrate existing hosts (re-derive from opensshHostPubkey or re-register). No cosmian/KMS dependency anywhere in the KRL en/decrypt path. This SUPERSEDES the KMS-resident 'adopted model' of decision-013 and the KMS-decrypt parts of SSH-15 (TASK-133) and SSH-24 (TASK-145). The detached CA signature over the KRL is unchanged (separate from ECIES). Write audit_log rows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST /api/v1/external/ssh/krl returns a ciphertext in the pinned native ECIES envelope encrypted to the host's own public key, and NO KMIP Encrypt/Decrypt/CreateKeyPair is invoked anywhere in the KRL en/decrypt path (asserted by test + code inspection)
- [ ] #2 A host decrypts the payload ENTIRELY locally with its private key - no network or KMS call - and recovers the exact plaintext; a backend-encrypt -> Go-client-decrypt vector test proves cross-implementation interop of the pinned envelope
- [ ] #3 The KMS-resident path is retired: registerHostEciesKey KMS keypair generation and kms_pubkey_id encryption are removed/repurposed, existing hosts are migrated, and decision-013's KMS-resident model is marked superseded by decision-015
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add backend/src/crypto/ssh/ecies.ts: native ECIES v1 (encrypt to OpenSSH ecdsa-sha2-nistp256 pubkey; decrypt for tests) matching the KRLC-02a pinned envelope.
2. Rewrite POST /api/v1/external/ssh/krl to encrypt natively to host.opensshHostPubkey (require ecdsa nistp256; clear NOT_PROVISIONED for ed25519); drop KMS eciesEncrypt.
3. Retire KMS-resident keypair gen: repurpose /register-host-pubkey + registerEciesKey (no KMS CreateKeyPair); stop using kms_pubkey_id for encryption.
4. Pin the wire format in a checked-in doc; write ecies unit tests + update ssh-ecies integration test to decrypt with the host SSH key.
5. pnpm -C backend typecheck + test.
<!-- SECTION:PLAN:END -->
