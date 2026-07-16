---
id: TASK-210
title: >-
  Force ecdsa-sha2-nistp256 host keys (single key = cert subject + ECIES
  recipient)
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-14 05:15'
updated_date: '2026-07-16 05:27'
labels: []
dependencies: []
ordinal: 37014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The register-host UI hardcodes ed25519 guidance, but ECIES KRL distribution (default) requires an ecdsa-sha2-nistp256 key. A single opensshHostPubkey field is overloaded as BOTH the cert subject and the ECIES recipient, so a host cannot have an ed25519 host cert AND ECIES KRL. There is also no way to edit a host's key or delete a host (fqdn is UNIQUE), which permanently traps a mistyped registration. Repro: host c1h1.dev.ymbihq.local registered with ed25519 -> krl-client fails ECIES_KEY_UNSUPPORTED; had to hand-edit prod SQLite twice.
<!-- SECTION:DESCRIPTION:END -->








## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Schema: add nullable ecies_pubkey to ssh_hosts; drizzle generate+migrate.
2. Service: register() accepts optional eciesPubkey; add updateHostKey (pending-only), setEciesKey (ecdsa P-256), deleteHost (pending/no-cert/no-blocks/no-krls); resolveEciesKey helper (eciesPubkey || opensshHostPubkey-if-ecdsa). Audit rows for each.
3. DTO: add hasEciesKey + eciesReady.
4. Zod: updateHostKeySchema, setEciesKeySchema; registerHostSchema += eciesPubkey?.
5. tRPC hostRouter: updateKey, setEciesKey, delete.
6. REST: PUT /hosts/:id/key, PUT /hosts/:id/ecies-key, DELETE /hosts/:id; POST /hosts passes eciesPubkey.
7. External /krl: encrypt to resolveEciesKey(host) not raw opensshHostPubkey.
8. Frontend register form: correct copy, optional ECIES key field, inline warning when no ecdsa key.
9. Frontend host detail: Replace key (pending), Set ECIES key, Delete (pending) actions.
10. Tests for service methods + ECIES resolution; typecheck both workspaces.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DIRECTION CHANGE: dropped the two-field (separate ecies_pubkey) approach — reverted entirely. Instead FORCE host keys to ecdsa-sha2-nistp256 so one key serves as both cert subject and ECIES recipient (ed25519 is a signing key and cannot do ECDH, so it can never be an ECIES recipient).

Implemented (working tree, not committed):
- backend/services/ssh-host.service.ts: assertEcdsaHostKey() helper + HOST_KEY_ALGORITHM const; register() rejects any non-P256 host key with an actionable message.
- backend/rest/routes/ssh-external.routes.ts: same guard on the fleet /sign-host key-rotation branch.
- frontend/routes/ssh.hosts.new.tsx: corrected copy (paste ssh_host_ecdsa_key.pub; ecdsa-sha2-nistp256 required + why), inline red warning + disabled submit when a non-ecdsa key is pasted.
- 10 test files: host-key ssh-keygen flipped ed25519 -> ecdsa (user keys stay ed25519; crypto-level sign tests and the deliberate ed25519-via-direct-insert ECIES test untouched).

Verified: strict typecheck clean (both workspaces); with KMS reachable all touched SSH suites pass (60+ tests, assertEcdsaHostKey=0 in failures). Live in dev stack (:52080): form shows ecdsa guidance; dev backend rejects ed25519 (clear msg) and accepts ecdsa. Operational: host1/c1h1 already converted to an ecdsa host cert (serial 40); old ed25519 cert (39) revoked.
<!-- SECTION:NOTES:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Registering a host with any non-ecdsa-sha2-nistp256 key is rejected with an actionable message (paste ssh_host_ecdsa_key.pub), on both the register API and the fleet sign-host key-rotation path
- [ ] #2 The register form states ecdsa-sha2-nistp256 is required and why, tells the user to paste /etc/ssh/ssh_host_ecdsa_key.pub, and shows an inline warning + disables submit when a non-ecdsa key is pasted
- [ ] #3 Encrypted KRL (ECIES) distribution encrypts to the host's own ecdsa-sha2-nistp256 host key; a non-ecdsa host key yields a clear error instead of a runtime ECIES_KEY_UNSUPPORTED failure
<!-- AC:END -->
