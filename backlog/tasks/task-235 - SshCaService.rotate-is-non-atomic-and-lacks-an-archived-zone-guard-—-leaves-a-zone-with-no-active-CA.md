---
id: TASK-235
title: >-
  SshCaService.rotate() is non-atomic and lacks an archived-zone guard — leaves
  a zone with no active CA
status: To Do
assignee: []
created_date: '2026-09-21 04:29'
labels:
  - ssh-ca
  - bug
  - rotation
dependencies: []
ordinal: 62014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`rotate()` (backend/src/services/ssh-ca.service.ts) demotes the predecessor CA to 'rotating' (a committed UPDATE) BEFORE calling `this.create()` for the successor, with no surrounding transaction and no archived-zone check up front. If the successor create fails — e.g. the target zone is archived (create() throws 'zone archived'), or KMS is unreachable — the demote has already committed, so the zone is left with a 'rotating'-only CA and NO active one. New issuance for that (zone, ca_type) then fails ('one active per type').

Observed live 2026-09-18 on pki.joor.net rotating the iotgw-ssh-ca-test (archived) zone User CA: predecessor went 'rotating', successor never created, zone had no active User CA. Recovered manually via unarchive -> create active CA -> re-archive.

Note the DB constraint that shapes the fix: partial-unique index `uq_ssh_cas_active_type` on (zone_id, ca_type) WHERE status='active' means two active CAs of the same (zone,type) can never coexist, so the demote must precede the successor INSERT at the SQL level. Also better-sqlite3 is synchronous — no async KMS call can run inside a db.transaction() callback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 rotate() validates the zone is NOT archived (and the CA is active) BEFORE any mutation; an archived zone aborts with nothing changed
- [ ] #2 The demote-predecessor + insert-successor DB writes are atomic (one better-sqlite3 transaction): if either fails, the predecessor remains active and no partial state persists
- [ ] #3 The KMS keypair for the successor is minted before the DB transaction; a KMS failure leaves the predecessor active and untouched
- [ ] #4 A regression test rotates a CA in an archived zone and asserts the predecessor stays active and no successor is created; and a happy-path test asserts predecessor->rotating + new active successor + predecessorCaId link
<!-- AC:END -->
