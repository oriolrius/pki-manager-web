---
id: TASK-246
title: 'SSH principals: Stale means principal files changed and not pushed'
status: Done
assignee:
  - '@claude'
created_date: '2026-11-23T18:57:00Z'
updated_date: '2026-11-23T19:04:00Z'
labels:
  - ssh
  - backend
dependencies: []
ordinal: 73014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today a host is Stale when host.updatedAt > lastPrincipalPushAt. Host certificate issue/renew also sets updatedAt, so every renewal flags the host Stale without any mapping change, and nothing in automation ever clears it. Track a dedicated change time that moves only when the host's rendered principal files change, and let fleet automation acknowledge a push with a hash of the exact files it installed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Issuing or renewing a host certificate does not make the host Stale
- [x] #2 Adding or removing a principal mapping on a host makes that host (and only that host) Stale until it is marked pushed
- [x] #3 After the migration, hosts that were already pushed (or have no mappings) are not Stale; hosts with mappings that were never pushed are Stale
- [x] #4 The fleet-token GET auth-principals response includes a sha256 of the rendered files in a documented canonical form
- [x] #5 A fleet token with get-principals can POST the sha256 to acknowledge a push: a matching hash clears Stale, a different hash returns 409 with the current hash and changes nothing
- [x] #6 Every acknowledgement attempt writes an audit_log row; docs/ssh-api-contract.md documents the endpoint and the canonical form
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Schema: add ssh_hosts.principals_changed_at (timestamp_ms); switch last_principal_push_at to timestamp_ms; migration 0012 converts existing push times to ms and backfills changed_at (never-pushed hosts with maps = updated_at, else clean).
2. Service: markPrincipalsChanged(hostId) helper, always strictly after the last push; markPushed sets push >= changed; stale = changed_at > push.
3. mapToHost uses the helper; host issue/renew and pubkey updates no longer affect staleness.
4. Canonical sha256 of the rendered files; returned by render (and so by the fleet GET).
5. POST /api/v1/external/ssh/hosts/:fqdn/principals-pushed {sha256} (get-principals op): 200 when it matches, 409 + current hash otherwise; audit both.
6. Tests: renewal not stale, map stale, ack match/mismatch/404/403, migration backfill.
7. docs/ssh-api-contract.md + follow-up task for the Ansible role.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Stale now means "the rendered auth_principals files changed and were not pushed".

- New column `ssh_hosts.principals_changed_at` (ms); `last_principal_push_at` switched to ms. Migration `0012_bent_scrambler.sql` converts existing push times (x1000) and backfills: hosts with mappings that were never pushed -> Stale (changed_at = updated_at); all other hosts -> clean (NULL). The old signal cannot separate a mapping change from a cert renewal, so pushed hosts get the benefit of the doubt.
- `markHostPrincipalsChanged()` stamps strictly after the last push; `markPushed`/ack stamp at or after the last change, so same-millisecond ordering is safe.
- Host cert issue/renew no longer affects staleness (they still write updatedAt).
- `render()` (tRPC, REST, fleet GET) returns `sha256`: canonical SHA-256 over `account NUL contents NUL` per account in ascending order.
- New `POST /api/v1/external/ssh/hosts/:fqdn/principals-pushed {sha256}` (op get-principals): 200 clears Stale; 409 `SHA256_MISMATCH` + `currentSha256`; 404 outside token zone. All attempts audited as `ssh.principal.mark_pushed`.
- docs/ssh-api-contract.md documents the GET, the canonical form and the ack. Ansible role change tracked in TASK-250.
- Tests: ssh-principal-stale.test.ts, ssh-principals-pushed.integration.test.ts, migrations-0012.test.ts.
<!-- SECTION:NOTES:END -->
