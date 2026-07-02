---
id: TASK-162
title: 'KRLC-04: Native-Go local ECIES decrypt against the host-held private key'
status: Done
assignee:
  - '@myself'
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 08:44'
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
- [x] #1 Given a ciphertext produced by the backend (KRLC-02) for a host registered pubkey, the decryptor recovers the exact plaintext JSON using only the local --host-key, with no network call
- [x] #2 A tampered ciphertext/tag, wrong key, or malformed framing fails AEAD authentication and maps to exit 3 (never a panic, never a partial or unauthenticated plaintext)
- [x] #3 No cosmian/openssl/jq/curl binary is invoked (verified by the absence of os/exec in the decrypt path); golden encrypt->decrypt vectors from KRLC-02 pass byte-for-byte
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
internal/decrypt: LoadHostKey parses the OpenSSH ecdsa host key (/etc/ssh/ssh_host_ecdsa_key) via ssh.ParseRawPrivateKey -> *ecdsa.PrivateKey -> crypto/ecdh; Open() decrypts the ECIES v1 envelope with crypto/ecdh + stdlib crypto/hkdf + AES-256-GCM. Pure in-process: NO KMS, NO network, no os/exec (verified — imports are crypto/* + x/crypto/ssh only). Matches the KRLC-02a pinned contract and the backend eciesEncryptV1. Tests: round-trip (self-contained sealV1 mirroring the backend) byte-identical; tamper/wrong-key/short-envelope/ed25519 all map to exit 3 (asserted). Committed 59fcbb3.
<!-- SECTION:NOTES:END -->
