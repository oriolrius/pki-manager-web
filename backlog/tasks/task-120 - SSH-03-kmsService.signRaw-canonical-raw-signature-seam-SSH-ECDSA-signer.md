---
id: TASK-120
title: 'SSH-03: kmsService.signRaw() canonical raw-signature seam + SSH ECDSA signer'
status: To Do
assignee: []
created_date: '2026-06-29 15:39'
updated_date: '2026-06-29 15:46'
labels:
  - ssh-cert-manager
  - crypto
  - backend
milestone: SSH Certificate Manager
dependencies:
  - TASK-117
  - TASK-118
  - TASK-119
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Introduce kmsService.signRaw(keyId, data, {hash:'sha256'|null, format:'der'|'ieee-p1363'}) in kms/service.ts as the canonical raw-signing primitive — the FIRST consumer on this branch (crl.service is still a placeholder, so this is authored, not reused; if/when CRL signing lands it adopts the same seam). Its BODY is whichever path SSH-SENS selected: non-exportable Cosmian native `ec sign`/KMIP Sign (preferred) or in-memory export via getPrivateKey + Node crypto.sign (fallback, with zeroization + alert). For SSH ECDSA certs the signer (crypto/ssh/sign.ts) requests ieee-p1363 output, splits fixed-width r||s, mpint-encodes each, and wraps as the OpenSSH ecdsa signature string. Writes a kms.sign_raw audit row on success and failure.

**Epic:** SSH Crypto Core & Baseline
**Logical deps:** SSH-SENS, SSH-01, SSH-02
**Touchpoints:** backend/src/kms/service.ts, backend/src/crypto/ssh/sign.ts, backend/src/crypto/ssh/sign.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 signRaw produces an ECDSA-P256 raw signature over arbitrary bytes that Node crypto.verify and openssl verify against the CA public key, in both der and ieee-p1363 formats
- [ ] #2 An SSH cert signed via the seam, presented to a real sshd trusting the CA public key, authenticates; ssh-keygen -L confirms the embedded 'Signing CA' fingerprint equals the CA's published OpenSSH public-key fingerprint
- [ ] #3 signRaw's body implements the SSH-SENS-selected path; if export-and-sign, the exported key buffer is zeroized after the op and every export emits an audit+alert row; every signing op produces a kms.sign_raw audit row and a failure produces a failure row
- [ ] #4 The seam is the single function the design names as the swap-point between non-exportable and export signing, and crl.service is not assumed to consume it on day one
<!-- AC:END -->
