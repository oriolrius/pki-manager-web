---
id: TASK-164
title: >-
  KRLC-06: Detached CA-signature verification (ECDSA-P256/SHA-256/DER, OpenSSH
  ca.pub)
status: Done
assignee:
  - '@myself'
created_date: '2026-07-01 07:14'
updated_date: '2026-07-02 14:42'
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
- [x] #1 Given the golden bare KRL, its DER CA signature, and the matching OpenSSH ecdsa-sha2-nistp256 ca.pub, ecdsa.VerifyASN1 returns true; a tampered KRL byte or swapped signature returns false and exits 4
- [x] #2 An OpenSSH-format ca.pub loads with no openssl dependency, and a PEM/SPKI form of the same key verifies identically
- [x] #3 A null ca_signature installs ONLY under --allow-unsigned (else exit 4); a non-null signature is never bypassed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
internal/verify: LoadCAKeys parses --ca-pubkey as OpenSSH authorized-keys lines (ssh.ParseAuthorizedKey -> ssh.CryptoPublicKey) or PEM/SPKI (x509.ParsePKIXPublicKey); supports multiple keys (TrustedUserCAKeys rotation). Verify: ecdsa -> ecdsa.VerifyASN1(pub, sha256(krl), derSig); ed25519 -> ed25519.Verify(pub, krl, sig). Check policy: null ca_signature installs only under --allow-unsigned else exit 4; present-but-invalid -> exit 4; verification precedes install (wired before the install step in app). --allow-unsigned flag added. 6 tests (ecdsa OpenSSH ca.pub, PEM/SPKI parity, tamper->4, null-sig policy, multi-key rotation, ed25519). No openssl dependency. Committed on feat/krl-client.
<!-- SECTION:NOTES:END -->
