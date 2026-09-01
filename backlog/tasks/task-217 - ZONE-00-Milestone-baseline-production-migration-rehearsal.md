---
id: TASK-217
title: 'ZONE-00: Milestone baseline + production migration rehearsal'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-09-01 04:44'
updated_date: '2026-09-01 05:06'
labels:
  - ssh-zones
  - ssh-cert-manager
  - backend
  - db
  - baseline
milestone: SSH Zones
dependencies: []
ordinal: 44014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pin the starting state the rest of the SSH Zones milestone depends on, and de-risk its single most dangerous step before any code is written.

decision-017 requires a `zone_id NOT NULL` FK on five tables and a swap of their unique indexes. SQLite can do neither in place, so drizzle-kit will emit rebuild-and-copy migrations (PRAGMA foreign_keys=OFF -> create new -> copy -> drop -> rename) for ssh_cas, ssh_hosts, ssh_identities, ssh_principals and ssh_fleet_tokens. Those five tables are referenced by nine others (ssh_certificates, ssh_revocations, ssh_krls, ssh_host_krls, ssh_user_principals, ssh_host_principal_maps, ssh_host_blocks, plus the two self-references in ssh_cas.predecessor_ca_id and ssh_certificates.superseded_by). A rebuild done with FKs off is exactly where referential damage happens silently.

Production is live: pki.joor.net runs on host y0 (ssh root@10.2.0.3) with SQLite at /opt/stacks/pki/data/pki/pki.db, holding real CAs, at least one enrolled host (c1h1) and a real identity. The rehearsal must happen on a byte copy of that DB, not on a synthetic one, because only the real DB has the row shapes and the FK graph that matter.

This task writes no production code. It produces the pinned facts that TASK-218 and TASK-230 consume.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The migration head tag and index are recorded in the task, read from _journal.json at execution time rather than assumed
- [ ] #2 A file:line inventory of every zone-coupled call site and every unique index that must be rekeyed is written down and usable as the checklist for TASK-218 through TASK-222
- [ ] #3 The rebuild-and-copy migration has been executed against a byte copy of the production database and the copy comes out with identical row counts in every ssh_* table
- [ ] #4 PRAGMA foreign_key_check returns empty on the migrated copy with foreign_keys ON, proving the rebuild preserved every reference
- [ ] #5 Every pre-existing ssh_cas, ssh_hosts, ssh_identities, ssh_principals and ssh_fleet_tokens row on the migrated copy carries the seeded default zone
- [ ] #6 The live production database was never written to during the rehearsal
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read backend/src/db/migrations/meta/_journal.json and record the current head tag + idx verbatim in the task notes (expected 0008_ssh_host_blocks / idx 8 -- verify, never assume).
2. Inventory the coupling, by grep, into the notes as a file:line table:
   - "active CA of type T" resolvers: ssh-user.service.ts, ssh-host.service.ts, ssh-external.routes.ts, ssh-ca.service.ts
   - the composed-KRL union in ssh-host-krl.service.ts
   - the global trust endpoints in ssh-public.routes.ts
   - upsert-by-fqdn / upsert-by-subject in ssh-external.routes.ts
   - every UNIQUE index that must be rekeyed, from db/schema.ts
3. Count and list the SSH-touching test files so TASK-218..222 can assert "no existing test needed editing".
4. Copy the production DB: on y0, `sqlite3 /opt/stacks/pki/data/pki/pki.db ".backup /tmp/pki-zone-rehearsal.db"` (a .backup, not a cp -- WAL), scp it to a scratch dir locally. NEVER run a migration against the live file.
5. Record the before-state: row counts for every ssh_* table + zones-to-be, `PRAGMA foreign_key_check` (must be empty), `PRAGMA integrity_check`.
6. Hand-write the candidate migration SQL (or generate a throwaway one from a scratch schema edit) and run it against the copy with foreign_keys ON afterwards.
7. Record the after-state: identical row counts, empty foreign_key_check, every ssh_* row carrying the default zone id, and the new unique indexes present in `.schema`.
8. Write findings + the exact verified SQL shape into the task notes so TASK-218 implements against evidence, not guesswork.
<!-- SECTION:PLAN:END -->
