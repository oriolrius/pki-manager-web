---
id: TASK-162
title: 'KRLC-04: Native-Go local ECIES decrypt against the host-held private key'
status: To Do
assignee: []
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 04:36'
labels:
  - ssh-cert-manager
  - automation
  - crypto
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-160
  - TASK-161
  - TASK-173
priority: high
ordinal: 4
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement internal/decrypt (local model, the shipped default): given the raw ECIES ciphertext from the 200 response, decrypt entirely in-process using the host local P-256 private key (--host-key) per the KRLC-02 envelope (ECDH with the ephemeral pubkey -> HKDF-SHA256 -> AES-256-GCM open). Pure Go std-lib crypto (crypto/ecdh, hkdf, crypto/aes + cipher.AEAD) - NO cosmian/openssl/jq shell-out and NO per-host KMS network call. Decrypt/authentication failures return exit 3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Given a ciphertext produced by the backend (KRLC-02) for a host registered pubkey, the decryptor recovers the exact plaintext JSON using only the local --host-key, with no network call
- [ ] #2 A tampered ciphertext/tag, wrong key, or malformed framing fails AEAD authentication and maps to exit 3 (never a panic, never a partial or unauthenticated plaintext)
- [ ] #3 No cosmian/openssl/jq/curl binary is invoked (verified by the absence of os/exec in the decrypt path); golden encrypt->decrypt vectors from KRLC-02 pass byte-for-byte
<!-- AC:END -->
