---
id: TASK-144
title: >-
  SSH-23: Spike Cosmian EC encrypt/decrypt (ECIES) + external-pubkey Register +
  locate-by-tag; v1 GATE for per-host distribution
status: Done
assignee:
  - '@myself'
created_date: '2026-06-29 15:44'
updated_date: '2026-06-29 18:32'
labels:
  - ssh-cert-manager
  - backend
  - revocation
  - kms
milestone: SSH Certificate Manager
dependencies:
  - TASK-141
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
v1 GATE spike: its outcome decides whether SSH-15/SSH-24 (per-host encrypted KRL distribution) proceed in v1. Following the SSH-SENS methodology, write a spike empirically testing, against the live Cosmian build on an ECDSA-P256 key: (a) REGISTER of an externally-supplied EC public key as a KMS object (genuinely new client work, not a tweak), (b) locate-by-tag, and (c) `ec encrypt`/`ec decrypt` (ECIES) round-trip — and confirm a host can DECRYPT a Cosmian-`ec encrypt` ciphertext with its own key (cross-implementation ECIES compatibility is version-specific). Record a decision (decision-013) capturing whether the per-host encrypted KRL path is viable and which client ops are missing. If ANY of (a)/(b)/(c) is unavailable, the per-host ECIES path is INFEASIBLE (not merely degraded), the decision documents the TLS-only + bare-KRL fallback, and SSH-24/SSH-15 are dropped from v1. The signed/served public KRL (SSH-22) does NOT depend on this; revocation is fully functional without it.

**Epic:** SSH Revocation & KRL
**Logical deps:** SSH-21
**Touchpoints:** backend/src/kms/spike-ssh-ecies.ts, backend/src/kms/client.ts, backlog/decisions/decision-013 - SSH-KRL-Distribution.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A spike empirically confirms or refutes, against the running KMS for nistp256: external-EC-pubkey Register, locate-by-tag, and ec encrypt/decrypt round-trip including a host decrypting a Cosmian-encrypted ciphertext
- [x] #2 A decision (decision-013) states whether per-host ECIES KRL is viable, the chosen fallback (TLS-only delivery of the bare/signed KRL), and names the single seam that changes if Cosmian later supports it
- [x] #3 If any required op is unavailable, the ECIES path is marked INFEASIBLE and SSH-24/SSH-15 remain deferred with no functional gap for revocation
- [x] #4 The KMS client gains Register/Locate/Encrypt/Decrypt wrappers ONLY if the spike proves they work; the spike skips when KMS_URL is unreachable
<!-- AC:END -->
