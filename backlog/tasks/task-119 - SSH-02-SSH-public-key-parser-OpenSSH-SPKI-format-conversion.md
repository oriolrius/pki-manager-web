---
id: TASK-119
title: 'SSH-02: SSH public-key parser + OpenSSH/SPKI format conversion'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-06-29 15:39'
updated_date: '2026-06-29 17:31'
labels:
  - ssh-cert-manager
  - crypto
  - backend
milestone: SSH Certificate Manager
dependencies:
  - TASK-116
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
crypto/ssh/pubkey.ts: the single chokepoint for accepting SSH public keys. Parses one-line OpenSSH authorized_keys-format keys (ssh-ed25519, ecdsa-sha2-nistp256) into a normalized struct { algo, blob, comment, fingerprintSha256 } and computes the SHA256:... fingerprint sshd logs. Rejects garbage, a private key pasted by mistake, and unsupported algorithms with clear validation errors. ssh-rsa subject keys are out of scope v1, but the rejection message is ACTIONABLE — it tells the operator to rekey to Ed25519/ECDSA rather than failing opaquely (so RSA-only fleet hosts have a clear migration path). Includes SPKI-PEM↔OpenSSH-line conversion for publishing a KMS-exported CA public key as an 'ecdsa-sha2-nistp256 AAAA...' line.

**Epic:** SSH Crypto Core & Baseline
**Logical deps:** SSH-00
**Touchpoints:** backend/src/crypto/ssh/pubkey.ts, backend/src/crypto/ssh/pubkey.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A valid ed25519 and a valid ecdsa-nistp256 pubkey both parse and the computed SHA256 fingerprint matches `ssh-keygen -lf <pubkey>`
- [ ] #2 Garbage input and a pasted private key each produce a clear validation error rather than a throw/crash; an ssh-rsa subject key is rejected with an actionable message instructing the operator to rekey to Ed25519/ECDSA
- [ ] #3 A KMS-exported ECDSA-P256 SPKI public key converts to a valid 'ecdsa-sha2-nistp256 AAAA...' OpenSSH line whose fingerprint matches ssh-keygen
- [ ] #4 The parser is the only path other services use to accept a host or user public key
<!-- AC:END -->
