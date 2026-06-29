---
id: TASK-123
title: 'SSH-06: Schema: ssh_hosts (+ KRL/principal telemetry) + ssh_identities'
status: To Do
assignee: []
created_date: '2026-06-29 15:40'
labels:
  - ssh-cert-manager
  - database
  - backend
milestone: SSH Certificate Manager
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add ssh_hosts (fqdn unique, display_name, addresses JSON array used as host-cert principals, openssh_host_pubkey, host_key_algorithm, kms_pubkey_id nullable until registered for ECIES, current_cert_id nullable FK, status 'pending'|'active'|'offboarded', enrolled_at, last_seen_at, PLUS telemetry columns last_krl_version, last_krl_fetch_at, last_principal_push_at so the distribution-status UI (SSH-29) and drift awareness (SSH-14) have a real data source) and ssh_identities (subject unique = audit key-id seed, external_subject nullable OIDC sub, email, openssh_user_pubkey nullable, pubkey_source 'uploaded'|'kms'|'per_request', kms_pubkey_id nullable, status 'active'|'disabled'). No private-key column anywhere; JSON arrays use the certificates.sanDns JSON.parse/stringify pattern.

**Epic:** SSH Data Model & Migrations
**Logical deps:** SSH-05
**Touchpoints:** backend/src/db/schema.ts, backend/src/db/migrations/
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The migration creates ssh_hosts (fqdn unique index; indexes on status, kms_pubkey_id; columns last_krl_version, last_krl_fetch_at, last_principal_push_at) and ssh_identities (subject unique index; indexes on status, external_subject)
- [ ] #2 A host can exist with no cert (status 'pending', current_cert_id NULL) and transition to 'active' and 'offboarded'; an identity can exist before any pubkey is supplied (pubkey_source 'per_request')
- [ ] #3 No table has a private-key column; addresses round-trips as string[] via JSON.parse/stringify; the telemetry columns are nullable and render as 'unknown' when absent
- [ ] #4 Exported SshHost/NewSshHost and SshIdentity/NewSshIdentity types; migration applies cleanly; typecheck passes
<!-- AC:END -->
