---
id: TASK-140
title: >-
  SSH-20: Native OpenSSH KRL encoder + version hashing (key-hash +
  explicit-serial)
status: In Progress
assignee:
  - '@myself'
created_date: '2026-06-29 15:43'
updated_date: '2026-06-29 18:18'
labels:
  - ssh-cert-manager
  - backend
  - revocation
milestone: SSH Certificate Manager
dependencies:
  - TASK-118
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add backend/src/crypto/ssh/krl.ts building a valid BARE (unsigned) OpenSSH-wire KRL from revocation directives (magic 'SSHKRL\0\0' + format version + section 0x20 certificates-by-serial in EXPLICIT mode, 0x21 certificates-by-key-id, 0x01 explicit-keys-by-hash), reusing the wire primitives from crypto/ssh/wire.ts (SSH-01). v1 supports revoke by EXPLICIT serial, key SHA256 hash (the PoC's UC9 path), and key-id — serial RANGE/bitmap sub-mode is OUT of v1 scope (per SSH-09 decision) to avoid the over-revocation foot-gun given serial gaps. krlVersion(bytes)='sha256:'+hex is the ETag. Pure function, no KMS, deterministic ordering, uint64 serials handled as bigint end-to-end. Cross-checked against `ssh-keygen -Qf` as an independent oracle.

**Epic:** SSH Revocation & KRL
**Logical deps:** SSH-01
**Touchpoints:** backend/src/crypto/ssh/krl.ts, backend/src/crypto/ssh/krl.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A KRL produced by the encoder is honoured by `ssh-keygen -Qf <krl> <pubkey>` (revoked key reported revoked, non-revoked not)
- [ ] #2 A key revoked by SHA256 hash and a cert revoked by explicit serial are both honoured by ssh-keygen -Qf; serial-range/bitmap encoding is explicitly not implemented in v1
- [ ] #3 krlVersion() returns a stable sha256:<hex> over the exact bytes; identical directive sets produce byte-identical KRLs
- [ ] #4 uint64 serials are handled as bigint with no silent precision loss
<!-- AC:END -->
