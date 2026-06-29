---
id: TASK-124
title: 'SSH-07: Schema: ssh_certificates (host + user certs, signed blob on-row)'
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
Add ssh_certificates, the core issued-cert table for both host and user OpenSSH certs, polymorphic via cert_type + nullable host_id/identity_id FKs. Stores ca_id, the per-CA uint64 serial, key_id (the -I audit anchor, denormalized for sshd-log correlation), principals JSON, valid_after/valid_before, extensions JSON array, critical_options JSON object, cert_openssh (the verbatim signed '*-cert.pub' bytes — persisted on-row like crls.crl_pem because the KMS produces no such object and re-signing is non-deterministic), subject_pubkey_fingerprint (sha256, for KRL key-revocation), kms_signing_key_id, status, revocation fields, source_type 'manual'|'automation', and superseded_by (nullable, set on renewal). Composite unique index on (ca_id, serial) — per-CA, not global.

**Epic:** SSH Data Model & Migrations
**Logical deps:** SSH-05, SSH-06
**Touchpoints:** backend/src/db/schema.ts, backend/src/db/migrations/
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The migration creates ssh_certificates with all listed columns; a composite unique index on (ca_id, serial); indexes on ca_id, status, cert_type, host_id, identity_id, key_id, subject_pubkey_fingerprint
- [ ] #2 A service-level invariant ensures cert_type='host' implies host_id set & identity_id null and cert_type='user' implies identity_id set & host_id null
- [ ] #3 cert_openssh holds the verbatim signed cert so re-download returns identical bytes — verified by issuing once and downloading twice with identical output
- [ ] #4 Exported SshCertificate/NewSshCertificate types; superseded_by supports renewal correlation; migration applies cleanly; typecheck passes
<!-- AC:END -->
