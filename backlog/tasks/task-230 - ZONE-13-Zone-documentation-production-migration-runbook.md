---
id: TASK-230
title: 'ZONE-13: Zone documentation + production migration runbook'
status: To Do
assignee: []
created_date: '2026-09-01 04:51'
updated_date: '2026-09-01 05:49'
labels:
  - ssh-zones
  - ssh-cert-manager
  - docs
  - ops
milestone: SSH Zones
dependencies:
  - TASK-229
ordinal: 57014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Document zones for operators and write the runbook for upgrading the live installation, which is the riskiest single moment of this milestone.

== Documentation ==
- docs/ssh/concept.md -- introduce the zone as the trust boundary alongside the two-CA / principal model. This is the page that explains why a principal must appear in both the certificate and auth_principals; zones are the third leg and belong here.
- docs/ssh/setup.md and docs/ssh/operator-quickstart.md -- the default zone, when to create a second one, and the fact that moving a host or identity between zones is an offboard + re-enroll rather than an edit.
- docs/ssh/deploy-server-and-user.md -- the zone-scoped trust URLs from TASK-225, with the unscoped ones marked deprecated.
- docs/ssh/principals-guide.md -- principal names are per zone; the same name in two zones is two distinct rows.
- docs/ssh/host-blocks-runbook.md -- blocks are within a zone.
- CLAUDE.md and backend/CLAUDE.md -- the data model summary and the "new endpoint" convention both predate zones.
- krl-client/README.md is owned by TASK-227; reference it, do not duplicate it.

== Production upgrade runbook (new: docs/ssh/zones-migration-runbook.md) ==
The live install is pki.joor.net on host y0 (ssh root@10.2.0.3), SQLite at /opt/stacks/pki/data/pki/pki.db. The migration rebuilds five tables with foreign keys off (see TASK-217/218). The runbook must state, in order:
1. take a `.backup` (not a cp -- the DB runs in WAL mode) and verify the copy opens and passes PRAGMA integrity_check
2. record before-state row counts for every ssh_* table
3. stop the stack, run db:migrate, restart
4. verify: identical row counts, empty PRAGMA foreign_key_check, every row on the 'default' zone, the two new partial unique indexes present
5. functional smoke: the deprecated unscoped trust URLs still answer with X-PKI-Zone: default; the enrolled host still pulls its KRL; a test user certificate still issues
6. rollback: stop, restore the backup file, restart -- and the explicit statement that rollback is only safe before any second zone is created, because zone rows have no representation in the old schema

== Downstream consumers (outside this repo) ==
- oriolrius.pki_manager Ansible collection (Galaxy, pinned >=2.3.0 in ansible/requirements.yml) -- unchanged by this milestone because the unscoped endpoints keep working; a zone-aware release is follow-up work in that repository. Say so explicitly so nobody assumes it was done here.
- pki-manager-cli (sibling Python CLI, generated from the OpenAPI spec) -- needs a client regeneration after TASK-224 to expose the zone endpoints and filters.

Write what shipped, including what did not. decision-017 defers cross-zone trust import, per-zone OIDC RBAC, X.509 adoption of zone_id, and in-place zone moves; the docs should name those as deferred rather than leave a reader guessing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The SSH concept, setup, deployment, principals and blocks guides all explain zones as the trust boundary
- [x] #2 An operator can follow a written runbook to upgrade the live installation, including backup, verification and rollback steps
- [x] #3 Every command in the runbook has been executed against a copy of the production database rather than only written down
- [x] #4 The runbook states explicitly at what point rollback stops being safe
- [x] #5 The docs name the downstream consumers that are not updated by this milestone and what each still needs
- [ ] #6 The deferred items from decision-017 are documented as deferred rather than left ambiguous
<!-- AC:END -->











## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Update the six docs/ssh pages and the two CLAUDE.md files listed above; keep each edit small and in the voice of the existing page.
2. Write docs/ssh/zones-migration-runbook.md following the structure of docs/ssh/host-blocks-runbook.md (that milestone's cutover runbook is the house pattern).
3. Verify every command in the runbook by running it against the rehearsal copy from TASK-217 -- a runbook with an untested command is worse than none.
4. Add the downstream-consumer section and the deferred-work section.
5. Cross-link decision-017 and doc-010 from the concept page so the next reader can find the contract.
6. Re-read the final docs against the shipped behaviour, not against this plan -- if a task changed shape during implementation, the docs follow the code.
<!-- SECTION:PLAN:END -->
