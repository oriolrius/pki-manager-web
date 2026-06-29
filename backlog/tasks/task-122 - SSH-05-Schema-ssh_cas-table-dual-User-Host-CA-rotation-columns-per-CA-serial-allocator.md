---
id: TASK-122
title: >-
  SSH-05: Schema: ssh_cas table (dual User/Host CA, rotation columns, per-CA
  serial allocator)
status: To Do
assignee: []
created_date: '2026-06-29 15:40'
labels:
  - ssh-cert-manager
  - database
  - backend
milestone: SSH Certificate Manager
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the ssh_cas Drizzle table to backend/src/db/schema.ts and the next sequential migration (number derived from the verified head per SSH-00, NOT hard-coded). One row per SSH CA with a caType ('user'|'host') discriminator, KMS key references (kms_key_id, kms_public_key_id), cached OpenSSH-format public key + fingerprint, key_algorithm constrained to ECDSA-P256 (Ed25519 CA rejected at the schema boundary; P-384 deferred), a next_serial monotonic allocator, lifecycle status('active'|'rotating'|'retired'), and ROTATION columns predecessor_ca_id + retire_after so getTrustAnchors can publish two keys during overlap. The partial unique index is relaxed to allow at most one 'active' PLUS at most one 'rotating' CA per type (so rotation does not violate the invariant). Distinct table — no X.509 fields; certificate_authorities untouched.

**Epic:** SSH Data Model & Migrations
**Logical deps:** SSH-00
**Touchpoints:** backend/src/db/schema.ts, backend/src/db/migrations/, backend/src/db/migrations/meta/_journal.json
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The migration creates ssh_cas with id, ca_type, label, kms_key_id, kms_public_key_id, openssh_public_key, fingerprint_sha256, key_algorithm (ECDSA-P256, schema-constrained), next_serial (default 1), status('active'|'rotating'|'retired'), predecessor_ca_id (nullable FK), retire_after (nullable), revocation fields, created_at, updated_at
- [ ] #2 A partial unique index allows at most one active and at most one rotating CA per ca_type; db:generate && db:migrate apply cleanly on a fresh DB and typecheck passes
- [ ] #3 Exported SshCa/NewSshCa types; ssh_cas carries no subjectDn/notAfter and the X.509 certificate_authorities table and queries are unchanged
- [ ] #4 next_serial covers the practical OpenSSH serial range (documented that SQLite INTEGER is signed 64-bit) and the migration file number is the next sequential after the verified head, not hard-coded
<!-- AC:END -->
