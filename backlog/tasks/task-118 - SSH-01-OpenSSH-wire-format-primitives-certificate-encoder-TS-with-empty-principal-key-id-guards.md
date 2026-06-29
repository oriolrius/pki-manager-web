---
id: TASK-118
title: >-
  SSH-01: OpenSSH wire-format primitives + certificate encoder (TS) with
  empty-principal/key-id guards
status: To Do
assignee: []
created_date: '2026-06-29 15:39'
labels:
  - ssh-cert-manager
  - crypto
  - backend
milestone: SSH Certificate Manager
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build a pure-TypeScript, dependency-free module (crypto/ssh/wire.ts + crypto/ssh/openssh-cert.ts) implementing the RFC4251 SSH wire primitives (string, uint32, uint64, mpint with leading-zero strip + high-bit positivity pad, name-list, lexicographically-sorted option/extension maps) and the PROTOCOL.certkeys field layout for ssh-ed25519 and ecdsa-sha2-nistp256 subject keys (P-384 OUT of scope for v1 to shrink the test matrix). Produces the to-be-signed (TBS) blob and, given a signature, the final one-line cert. Nonce = 32 bytes from crypto.randomBytes (a security control). permit-* extensions encoded with empty-string values; force-command/source-address string-wrapped; both maps name-sorted. The wire primitives are deliberately shared with the KRL encoder (SSH-20). SECURITY GUARDS: reject an empty valid_principals list by default (empty = 'valid for all', a host cert matching any hostname / a user cert for any login) unless an explicit wildcard flag is set; constrain key_id to a printable, control-character-free grammar (it is logged verbatim by sshd and is the audit anchor) so it cannot corrupt auth logs.

**Epic:** SSH Crypto Core & Baseline
**Logical deps:** SSH-00
**Touchpoints:** backend/src/crypto/ssh/wire.ts, backend/src/crypto/ssh/openssh-cert.ts, backend/src/crypto/ssh/openssh-cert.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ssh-keygen -L -f <emitted-cert> reports the correct Type, Serial, Key ID, Principals, Valid range, Critical Options, and Extensions for ed25519 and ecdsa-nistp256 subject keys, and the pre-signature TBS region byte-for-byte matches what a local ssh-keygen CA signs for identical inputs
- [ ] #2 permit-pty present vs absent, force-command=<cmd>, and source-address=<cidr> round-trip exactly through ssh-keygen -L; empty and multi-principal lists both encode and re-parse correctly
- [ ] #3 Issuing with an empty principals list is rejected unless an explicit wildcard flag is set; key_id containing control characters is rejected; both guards are unit-tested
- [ ] #4 The module has no runtime npm dependency (no forge/sshpk/ssh2), supports only ed25519 + ecdsa-nistp256 subjects in v1, and is exhaustively unit-tested
<!-- AC:END -->
