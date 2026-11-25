---
id: TASK-210
title: >-
  Force ecdsa-sha2-nistp256 host keys (single key = cert subject + ECIES
  recipient)
status: Done
assignee:
  - '@myself'
created_date: '2026-07-14 05:15'
updated_date: '2026-07-16 05:28'
labels: []
dependencies: []
ordinal: 37014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The register-host UI hardcoded ed25519 guidance, but ECIES KRL distribution (the default) requires an ecdsa-sha2-nistp256 key, and a single opensshHostPubkey field serves as BOTH the cert subject and the ECIES recipient. An ed25519 host key cannot be an ECIES recipient (it is a signing key and cannot do ECDH), so a mistyped ed25519 registration produced ECIES_KEY_UNSUPPORTED and, with fqdn UNIQUE and no self-service fix, permanently trapped the registration (prod SQLite hand-edited twice). Repro: host c1h1.dev.ymbihq.local registered with ed25519 -> krl-client fails ECIES_KEY_UNSUPPORTED. Chosen solution: FORCE host keys to ecdsa-sha2-nistp256 so the one key is both cert subject and ECIES recipient, and reject non-ecdsa keys at registration so the trap can never occur (rather than adding edit/delete escape hatches).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Registering a host with any non-ecdsa-sha2-nistp256 key is rejected with an actionable message (paste ssh_host_ecdsa_key.pub), on both the register API and the fleet sign-host key-rotation path
- [x] #2 The register form states ecdsa-sha2-nistp256 is required and why, tells the user to paste /etc/ssh/ssh_host_ecdsa_key.pub, and shows an inline warning + disables submit when a non-ecdsa key is pasted
- [x] #3 Encrypted KRL (ECIES) distribution encrypts to the host's own ecdsa-sha2-nistp256 host key; a non-ecdsa host key yields a clear error instead of a runtime ECIES_KEY_UNSUPPORTED failure
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. backend ssh-host.service.ts: add HOST_KEY_ALGORITHM const + assertEcdsaHostKey() helper; register() rejects any non-ecdsa-sha2-nistp256 host key with an actionable message.
2. backend ssh-external.routes.ts: same assertEcdsaHostKey guard on the fleet /sign-host key-rotation branch; ECIES/KRL encrypts to the host own ecdsa key and errors clearly on a non-ecdsa key.
3. frontend ssh.hosts.new.tsx: corrected copy (paste /etc/ssh/ssh_host_ecdsa_key.pub; ecdsa-sha2-nistp256 required + why), inline red warning + disabled submit when a non-ecdsa key is pasted.
4. Tests: flip host-key ssh-keygen ed25519 -> ecdsa across SSH suites (user keys stay ed25519; crypto sign tests and the deliberate ed25519-via-direct-insert ECIES test untouched); strict typecheck both workspaces.

NOTE: the original plan (nullable ecies_pubkey column, updateHostKey/setEciesKey/deleteHost, PUT/DELETE routes, host-detail edit/delete UI) was reverted — forcing ecdsa at registration removes the need for edit/delete escape hatches.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DIRECTION CHANGE: dropped the two-field (separate ecies_pubkey) approach — reverted entirely. Instead FORCE host keys to ecdsa-sha2-nistp256 so one key serves as both cert subject and ECIES recipient (ed25519 is a signing key and cannot do ECDH, so it can never be an ECIES recipient).

Implemented (committed: 19d5ffa "fix(ssh): require ecdsa-sha2-nistp256 host keys, fix register-form guidance" + 3a97475 e2e ecdsa host keys):
- backend/services/ssh-host.service.ts: assertEcdsaHostKey() helper + HOST_KEY_ALGORITHM const; register() rejects any non-P256 host key with an actionable message.
- backend/rest/routes/ssh-external.routes.ts: same guard on the fleet /sign-host key-rotation branch; ECIES/KRL encrypts to the host own ecdsa key.
- frontend/routes/ssh.hosts.new.tsx: corrected copy (paste ssh_host_ecdsa_key.pub; ecdsa-sha2-nistp256 required + why), inline red warning + disabled submit when a non-ecdsa key is pasted.
- 10 test files: host-key ssh-keygen flipped ed25519 -> ecdsa (user keys stay ed25519; crypto-level sign tests and the deliberate ed25519-via-direct-insert ECIES test untouched).

Verified: strict typecheck clean (both workspaces); with KMS reachable all touched SSH suites pass (60+ tests). Live in dev stack (:52080): form shows ecdsa guidance; dev backend rejects ed25519 (clear msg) and accepts ecdsa. Operational: host1/c1h1 already converted to an ecdsa host cert (serial 40); old ed25519 cert (39) revoked.
<!-- SECTION:NOTES:END -->
