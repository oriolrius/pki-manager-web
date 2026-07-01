---
id: TASK-160
title: >-
  KRLC-02: Backend - encrypt per-host KRL to a host-held ECIES pubkey + pin the
  ECIES envelope
status: To Do
assignee: []
created_date: '2026-07-01 07:14'
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
Enable the local-key distribution model: change the backend so a host registers its OWN P-256 ECIES public key and the encrypted endpoint (POST /api/v1/external/ssh/krl) encrypts to that host-held key, so the private half never leaves the host. Extend registerHostEciesKey / add an external-pubkey registration path (accept a host-supplied P-256 SPKI/OpenSSH pubkey; import into the KMS via KMIP Import or bypass the KMS for this path) and persist the host pubkey id on the ssh_hosts row. Define and PIN a standard, documented ECIES envelope for this path - curve P-256, HKDF-SHA256 KDF, AES-256-GCM AEAD, explicit wire framing (ephemeral-pubkey || nonce || ciphertext || tag) - as the interop contract the Go client native decryptor implements, mirroring how SSH-04/TASK-121 pinned the detached-signature format. Keep the existing KMS-resident path intact behind its flag. Write an audit_log row for registration and every encrypted KRL fetch (success and failure).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A host can register a self-generated P-256 ECIES public key, and a subsequent POST /api/v1/external/ssh/krl for that host returns a ciphertext decryptable ONLY with the corresponding host-held private key (verified by a round-trip test)
- [ ] #2 The ECIES envelope (curve, KDF, AEAD, byte framing) is specified in a checked-in wire-format doc and covered by an encrypt->decrypt vector test, with no dependency on Cosmian opaque ECIES for this path
- [ ] #3 Registering an invalid or non-P256 pubkey is rejected with a clear error, and an audit_log row is written for both registration and each encrypted KRL fetch (success and failure)
<!-- AC:END -->
