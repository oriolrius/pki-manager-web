---
id: TASK-185
title: 'BLK-08: API — ssh.block.* + host-access/state read model (tRPC + REST twins)'
status: Done
assignee:
  - '@myself'
created_date: '2026-07-03 21:26'
updated_date: '2026-07-03 23:12'
labels:
  - ssh-host-blocks
  - backend
  - api
milestone: SSH Host Access Blocks
dependencies:
  - TASK-181
  - TASK-184
references:
  - docs/ssh-api-contract.md
priority: medium
ordinal: 12014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Zod-first (single schema source for tRPC + OpenAPI, existing SSH pattern).

MUTATIONS: ssh.block.block / ssh.block.unblock as sshProtectedProcedure — deliberately the same tier as host revoke/offboard (trpc/procedures/ssh.ts); CA-level actions stay admin-only. REST twins under /api/v1/ssh. Block responses carry the BLK-04 shared-fingerprint collision warnings for the UI confirm.

READ MODEL the three UI surfaces need (no N+1 — this is NEW backend work, not just wiring):
- ssh.host.access: identity-level entitlement join for a host (ssh_user_principals x ssh_host_principal_maps -> identity / via-roles / local accounts — whoCanBecome() discards identities today, ssh-principal.service.ts:176-203) merged with block rows + per-host state (BLK-07)
- ssh.block.listForIdentity returning {hostId, fqdn, state} tuples for the Users-page pills
- fleet distribution query for the KRL page: per-host {blockCount, state} in one query

Update docs/ssh-api-contract.md: block ops, read-model endpoints, GET /krl/hosts/:hostId.bin|.json, SSH_HOST_KRL_PUBLIC + SSH_HOST_KRL_SERVE gates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ssh.block.block/unblock tRPC + REST twins with Zod parity; audit verified through the API path
- [x] #2 SSH-34 fail-closed test: OIDC disabled => FORBIDDEN on both transports; ALLOW_UNAUTHENTICATED_SSH_CA dev bypass honored
- [x] #3 ssh.host.access returns identity / via-roles / local-accounts + blocked rows with state in one query; fleet query returns per-host blockCount + state without N+1
- [x] #4 docs/ssh-api-contract.md updated for all new endpoints and env gates
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
tRPC: new blockRouter (block/unblock/listForHost/listForIdentity/fleetDistribution) + ssh.host.access; actor (createdBy/liftedBy) from OIDC claims when present; SshBlockError wired into mapSshError. REST twins in ssh.routes.ts share the same Zod schemas (blockHostSchema/unblockHostSchema in ssh-schemas.ts) and ensureSshAllowed. Read model in SshBlockService: stateForHosts batch helper (latest per-host rows + block events in 2 queries), hostAccess entitlement join (ssh_host_principal_maps x ssh_user_principals x ssh_identities in 1 query; pre-emptively blocked non-entitled identities batched in), listForIdentityWithState, fleetDistribution (hosts + blocks + latest numbers, grouped in JS). docs/ssh-api-contract.md: block ops table, composed-payload semantics + first-fetch NO_KRL, host-ca-keys + public per-host endpoints, SSH_HOST_KRL_SERVE/SSH_HOST_KRL_PUBLIC gates, state glossary. Tests 6/6 (src/trpc/procedures/ssh-block-api.test.ts, KMS mocked): fail-closed on BOTH transports (tRPC FORBIDDEN + REST 403; opt-in honored by the functional suite), round-trip with warnings + audit through API path, REST Zod parity (400 on bad body), access join (alice admins->root unblocked, carol blocked-not-entitled), tuples + fleet with state. Strict typecheck clean.
<!-- SECTION:NOTES:END -->
