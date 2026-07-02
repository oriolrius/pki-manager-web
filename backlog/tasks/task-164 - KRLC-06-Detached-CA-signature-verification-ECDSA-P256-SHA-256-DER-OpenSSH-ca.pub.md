---
id: TASK-164
title: >-
  KRLC-06: Detached CA-signature verification (ECDSA-P256/SHA-256/DER, OpenSSH
  ca.pub)
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 14:40'
labels:
  - ssh-cert-manager
  - automation
  - crypto
milestone: SSH KRL Client Distribution
dependencies:
  - TASK-161
priority: high
ordinal: 6
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement internal/verify: load --ca-pubkey - accept OpenSSH 'ecdsa-sha2-nistp256 AAAA... comment' (via golang.org/x/crypto/ssh.ParseAuthorizedKey -> ssh.CryptoPublicKey.CryptoPublicKey() -> *ecdsa.PublicKey) OR PEM/SPKI (x509.ParsePKIXPublicKey). Verify the detached signature over the bare KRL: h := sha256.Sum256(krlBytes); ecdsa.VerifyASN1(pub, h[:], derSig). If ca_signature is null, install only under --allow-unsigned (documented TLS-trusted fallback); a present-but-invalid signature always fails (exit 4). Verification precedes any install.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Given the golden bare KRL, its DER CA signature, and the matching OpenSSH ecdsa-sha2-nistp256 ca.pub, ecdsa.VerifyASN1 returns true; a tampered KRL byte or swapped signature returns false and exits 4
- [ ] #2 An OpenSSH-format ca.pub loads with no openssl dependency, and a PEM/SPKI form of the same key verifies identically
- [ ] #3 A null ca_signature installs ONLY under --allow-unsigned (else exit 4); a non-null signature is never bypassed
<!-- AC:END -->
