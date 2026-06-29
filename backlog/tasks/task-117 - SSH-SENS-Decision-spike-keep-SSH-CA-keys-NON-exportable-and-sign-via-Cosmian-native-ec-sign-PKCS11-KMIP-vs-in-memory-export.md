---
id: TASK-117
title: >-
  SSH-SENS: Decision + spike: keep SSH CA keys NON-exportable and sign via
  Cosmian native ec sign (PKCS#11/KMIP) vs in-memory export
status: In Progress
assignee:
  - '@myself'
created_date: '2026-06-29 15:38'
updated_date: '2026-06-29 17:08'
labels:
  - ssh-cert-manager
  - crypto
  - backend
  - kms
  - security
milestone: SSH Certificate Manager
dependencies:
  - TASK-116
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
BLOCKING decision before any signer or CA service is built. The source PoC creates both CA keys `--sensitive true` (NON-exportable, kms-sign.sh:38) and signs via PKCS#11/ssh-agent (`ssh-add -s libcosmian_pkcs11.so` then `ssh-keygen -Us`) so the CA key NEVER leaves KMS, and the PoC's distributor signs KRLs with Cosmian native `ec sign` over nistp256. In-memory export-and-sign (getPrivateKey→Node crypto.sign) is the path the PoC deliberately avoids and widens the blast radius of any backend RCE/heap-dump from time-bounded signing access to permanent CA-key theft (technical-reference §10.5.3). This task empirically probes, against the LIVE KMS, three things and records the result with reproduced evidence (not a referenced-but-missing spike): (a) KMIP-JSON Sign on an ECDSA-P256 key marked sensitive; (b) Cosmian native `ec sign` on the same; (c) whether a NON-sensitive EC key exports via getPrivateKey in a layout Node crypto.createPrivateKey accepts (or needs SEC1/PKCS#8 normalization). This subsumes the prior EC-export round-trip probe. The non-exportable path is preferred and adopted if (a) or (b) yields a usable signature; export-and-sign is adopted only if BOTH are impossible, then with the exported buffer zeroized after one op and a loud audit+alert on every export. Names the single signRaw implementation that changes between modes.

**Epic:** SSH Crypto Core & Baseline
**Logical deps:** SSH-00
**Touchpoints:** backend/src/kms/spike-ssh-sign.ts, backend/src/kms/service.ts, backend/src/kms/client.ts, backlog/decisions/decision-011 - SSH-Certificate-Signing-Approach.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A spike against the live KMS records the exact result (HTTP status + signature format) of signing an ECDSA-P256 key marked --sensitive true via (a) KMIP-JSON Sign and (b) Cosmian native ec sign, and (c) whether a non-sensitive EC key exports in a Node-importable layout (with a normalization helper if SEC1/EC-PARAMETERS-only)
- [ ] #2 A decision (decision-011) selects the non-exportable native-sign path if (a) or (b) works; export-and-sign is selected ONLY if both are proven impossible, and then documents the residual risk, a named risk owner, buffer-zeroization after one op, and a loud audit+alert on every CA-key export
- [ ] #3 If export-and-sign is chosen, ssh_cas CA keys are created non-exportable for normal issuance is reconciled with the chosen path (i.e. the decision states the exact KMS key-creation flags used) so issuance does not fail at runtime against a sensitive key
- [ ] #4 The decision names signRaw as the single function whose body differs between non-exportable-sign and export-and-sign, and the spike skips (not fails) when KMS_URL is unreachable
<!-- AC:END -->
