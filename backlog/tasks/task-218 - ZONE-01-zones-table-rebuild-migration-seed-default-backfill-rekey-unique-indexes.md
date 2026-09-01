---
id: TASK-218
title: >-
  ZONE-01: zones table + rebuild migration (seed default, backfill, rekey unique
  indexes)
status: In Progress
assignee:
  - '@myself'
created_date: '2026-09-01 04:45'
updated_date: '2026-09-01 05:24'
labels:
  - ssh-zones
  - ssh-cert-manager
  - backend
  - db
  - migration
milestone: SSH Zones
dependencies:
  - TASK-217
ordinal: 45014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the `zones` table and rescope the five natural keys and two partial unique indexes that currently make the SSH CA a single-trust-domain system.

Per decision-017 the table is deliberately named `zones`, NOT `ssh_zones`, so X.509 CAs/certificates/clusters can adopt the same `zone_id` later without a rename. Only SSH tables reference it in this change.

New table:
  zones(id TEXT PK, name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL DEFAULT 'active' /* active | archived */, created_at, updated_at)
`name` is a URL-safe slug -- it appears in /ssh/zones/:zone/... routes and in the frontend search param.

FK wiring, all `zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE RESTRICT`:
  - ssh_cas       -- and uq_ssh_cas_active_type / uq_ssh_cas_rotating_type (schema.ts:243-248)
                     move from (ca_type) to (zone_id, ca_type), keeping their partial
                     WHERE status = 'active' / 'rotating' clauses
  - ssh_hosts     -- fqdn UNIQUE (schema.ts:257) becomes UNIQUE (zone_id, fqdn)
  - ssh_identities -- subject UNIQUE (schema.ts:287) becomes UNIQUE (zone_id, subject)
  - ssh_principals -- name UNIQUE (schema.ts:349) becomes UNIQUE (zone_id, name)
  - ssh_fleet_tokens -- user_ca_id / host_ca_id must belong to that zone (service-enforced)

Deliberately NOT given a zone_id, because their zone is derived and a denormalized copy could drift: ssh_certificates and ssh_revocations and ssh_krls (via ca_id), ssh_host_krls (via host_id), ssh_user_principals and ssh_host_principal_maps and ssh_host_blocks (via their parents).

ssh_krl_seq (schema.ts:509) stays a SINGLE GLOBAL allocator. Sharding it per zone would break the krl-client's strictly-increasing anti-rollback check (decision-016 pinned req #4) for any host whose lineage changes.

The migration must seed one zone (name 'default', display_name 'Default'), backfill it onto every existing row, and only then apply NOT NULL -- so an existing single-zone installation, including live pki.joor.net, comes out behaviourally identical.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Two zones can each hold their own active User CA and their own active Host CA at the same time
- [x] #2 A second active CA of the same type within one zone is still rejected by the database, so rotation semantics are unchanged
- [x] #3 The same host FQDN, the same identity subject and the same principal name can each exist once per zone and not twice within a zone
- [x] #4 Running the migration on an existing single-zone database leaves every SSH row intact and attached to a seeded 'default' zone
- [x] #5 A zone that still owns CAs, hosts, identities or principals cannot be deleted
- [x] #6 pnpm typecheck is clean and the full backend suite passes with no pre-existing test edited
<!-- AC:END -->













## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Re-read backend/src/db/migrations/meta/_journal.json for the current head; the new migration is head+1 (do not hard-code 0009 without checking).
2. Edit backend/src/db/schema.ts: add the `zones` table + Zone/NewZone type exports; add zoneId to the five tables; rewrite the affected index definitions.
3. `pnpm db:generate`, then HAND-EDIT the generated SQL -- drizzle-kit will emit a rebuild that drops rows or fails on NOT NULL. The migration must, in order:
   a. CREATE TABLE zones + INSERT the 'default' row (a fixed, readable id such as 'zone-default' so the runbook and tests can reference it).
   b. For each of the five tables: PRAGMA foreign_keys=OFF (drizzle wraps this) -> create the new table WITH zone_id NOT NULL -> INSERT ... SELECT copying every column and 'zone-default' as zone_id -> DROP old -> ALTER RENAME -> recreate ALL of its indexes, including the ones that are not changing.
   c. Recreate the two partial unique indexes on (zone_id, ca_type).
4. Verify against the ZONE-00 rehearsal copy again with the FINAL generated SQL, not just the hand-written candidate.
5. Extend backend/src/db/ssh-schema.test.ts (and ssh-host-blocks.schema.test.ts if it asserts index shapes) with tests that: two zones can each hold their own active user CA; a second active user CA in the SAME zone is rejected; the same fqdn/subject/principal name is allowed in two zones and rejected twice in one; deleting a zone that still has rows fails.
6. `pnpm db:migrate` on a scratch DB, `pnpm typecheck`, full backend suite.
<!-- SECTION:PLAN:END -->
