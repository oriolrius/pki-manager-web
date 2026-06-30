---
id: TASK-121
title: >-
  SSH-04: Pin and document the detached-signature format end-to-end (signer ↔
  KRL puller ↔ KMS)
status: Done
assignee: []
created_date: '2026-06-29 15:39'
updated_date: '2026-06-29 17:48'
labels:
  - ssh-cert-manager
  - crypto
  - backend
milestone: SSH Certificate Manager
dependencies:
  - TASK-120
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
OpenSSH in-cert signatures use ssh-string-wrapped r||s mpints; detached signatures (the KRL envelope consumed by the host-side puller, and any Cosmian `ec sign` output) default to DER/ASN.1. A format mismatch causes silent verify failures — or worse, a path that appears to verify but doesn't. SSH-03 handles the in-cert case; this task pins the DETACHED signature format used for the KRL envelope and any future KMS-native swap, and adds cross-compatibility tests so the puller's verifier and the backend signer agree regardless of whether the signature came from Node export-and-sign or Cosmian native ec sign.

**Epic:** SSH Crypto Core & Baseline
**Logical deps:** SSH-03
**Touchpoints:** backend/src/crypto/ssh/sign.ts, backend/src/crypto/ssh/sign.test.ts, backlog/decisions/decision-011 - SSH-Certificate-Signing-Approach.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The detached KRL/envelope signature format (DER vs raw r||s) is fixed and documented, and the (future) host-side puller verifier is specified to use the same format and curve
- [x] #2 A test asserts a backend-produced detached signature over fixed bytes verifies with the chosen verifier library/curve
- [x] #3 A test asserts the chosen format verifies consistently whether the signature comes from Node export-and-sign or a Cosmian-native ec sign output over identical bytes, so swapping signing backends does not silently break verification
- [x] #4 The pinned format is referenced by the KRL service (SSH-21) and the deferred puller (SSH-24) so neither re-decides it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Detached signature format pinned to DER (KMS-native); derToP1363/derToSshEcdsaSignature; cross-format verify tests (Node DER + ieee-p1363). sign.test.ts (5).
<!-- SECTION:NOTES:END -->
