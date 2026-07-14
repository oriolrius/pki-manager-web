---
id: TASK-210
title: >-
  Fix SSH host key model: edit/replace key, delete host, and separate ECIES key
  from cert key
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-14 05:15'
updated_date: '2026-07-14 05:24'
labels: []
dependencies: []
ordinal: 37014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The register-host UI hardcodes ed25519 guidance, but ECIES KRL distribution (default) requires an ecdsa-sha2-nistp256 key. A single opensshHostPubkey field is overloaded as BOTH the cert subject and the ECIES recipient, so a host cannot have an ed25519 host cert AND ECIES KRL. There is also no way to edit a host's key or delete a host (fqdn is UNIQUE), which permanently traps a mistyped registration. Repro: host c1h1.dev.ymbihq.local registered with ed25519 -> krl-client fails ECIES_KEY_UNSUPPORTED; had to hand-edit prod SQLite twice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A registered host's public key can be replaced through the UI/API before a cert is issued
- [x] #2 A host can be assigned a separate ecdsa-sha2-nistp256 ECIES key independent of its certificate key, and ECIES KRL uses it
- [x] #3 A pending host with no issued certificate can be deleted through the UI/API, freeing its FQDN
- [x] #4 The register form guides the user to the correct key type and warns when ECIES KRL would not work
<!-- AC:END -->

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
Implemented (working tree; not committed/deployed).

Backend:
- schema.ts: +ssh_hosts.ecies_pubkey (nullable). Migration 0009_violet_master_mold.sql (ALTER TABLE ADD COLUMN).
- ssh-host.service.ts: resolveEciesRecipient() (dedicated ECIES key, else P-256 cert key, else null); parseEciesKey() validator; register() accepts optional eciesPubkey; new updateHostKey (pending-only), setEciesKey (ecdsa P-256), deleteHost (never-certified only). DTO +hasEciesKey/+eciesReady. registerEciesKey now resolves via recipient.
- ssh-external.routes.ts /krl: encrypts to resolveEciesRecipient(host) not raw opensshHostPubkey -> ed25519-cert hosts can receive encrypted KRLs once an ECIES key is set.
- audit.ts: +ssh.host.update_key/set_ecies_key/delete.
- ssh-schemas.ts: updateHostKeySchema, setEciesKeySchema, registerHostSchema += eciesPubkey?.
- tRPC hostRouter: updateKey, setEciesKey, delete. REST: PUT /hosts/:id/key, PUT /hosts/:id/ecies-key, DELETE /hosts/:id; POST /hosts passes eciesPubkey.

Frontend:
- ssh.hosts.new.tsx: corrected key guidance, optional ECIES key field, inline ECIES-unreachable warning.
- ssh.hosts.$id.tsx: Replace key (pending), Set/Replace ECIES key, Delete (never-certified) actions + ECIES-readiness line.

Tests: new ssh-host-edit.test.ts (8) green; ssh state/ecies/openapi/block-api (40) green; frontend (45) green. Strict typecheck clean both workspaces. ESLint could not run (pre-existing @eslint/eslintrc+ajv env failure).

Back-compat: existing ecdsa-registered hosts and the c1h1 hotfix keep working via the P-256 cert-key fallback. Needs a release + prod db:migrate to reach pki.joor.net.
<!-- SECTION:NOTES:END -->
