---
id: TASK-233
title: SSH cert purge — hard-delete a mis-issued certificate (UI + REST + tRPC)
status: Done
assignee:
  - '@myself'
created_date: '2026-09-08 04:48'
updated_date: '2026-09-08 05:00'
labels:
  - ssh
  - security
dependencies: []
ordinal: 60014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a 'purge' operation that fully removes an SSH certificate row and all its DB trace, for the case of a cert created by mistake that never left the server. Distinct from host offboard/decommission. Guard-railed: admin-only, explicit confirmation, always writes an audit_log row. KRL-safe by construction — active (never-revoked) certs purge purely (serial was never in the KRL); revoked-but-still-valid certs require ?force and by default preserve the revocation as a standalone serial directive so the KRL keeps revoking them, with an explicit ?dropRevocation escape hatch (loud, re-enables the cert) for the never-distributed case; expired certs purge freely. Must be prominently documented in OpenAPI/Swagger descriptions and UI help so the admin knows exactly what each variant does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Admin can purge an active (never-revoked), non-expired cert and it disappears with zero KRL change; the serial can be re-issued
- [x] #2 Purging a revoked, still-valid cert without force returns 409; with force (default) the serial is preserved in the KRL via a serial directive; with force+dropRevocation the serial is removed from the KRL
- [x] #3 Every purge writes an ssh.cert.purge audit_log row (serial, reason, operator, whether KRL was regenerated); a second purge of the same id is 404, never 500
- [x] #4 Operation is exposed over both tRPC (ssh.krl.purgeCert) and REST (DELETE /api/v1/ssh/certs/:id) with rich OpenAPI + UI help text explaining pure vs preserve vs dropRevocation
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. SshKrlService.purgeCert() — branch by state (active=pure, revoked+valid=force+preserve/drop, expired=free); always audit; regen KRL only when revoked
2. SshCertPurgeForbiddenError -> 409/CONFLICT in REST + tRPC
3. tRPC ssh.krl.purgeCert + REST DELETE /ssh/certs/:id with rich OpenAPI docs; parity map entry
4. Frontend Purge button + state-aware confirm dialog (dropRevocation checkbox) in ssh.users.tsx
5. Tests: ssh-cert-purge.integration.test.ts (6 cases) + parity guard
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented cert purge across service + both APIs + UI, all typecheck/lint clean, 738 backend tests pass (incl. 6 new purge cases + the REST/tRPC parity guard).

Backend:
- SshKrlService.purgeCert(ctx, certId, {force, dropRevocation, reason}) in ssh-krl.service.ts — state-branched: active=pure purge (no KRL regen, serial never in KRL); revoked+valid needs force and by default materialises the serial as a standalone ssh_revocations directive (kill-switch survives the row); dropRevocation removes it from the KRL; expired purges freely. Detaches superseded_by self-FK + ssh_hosts.current_cert_id pointer, clears ssh_idempotency, deletes cert row. Always writes ssh.cert.purge audit_log.
- SshCertPurgeForbiddenError -> 409 CERT_REVOKED_NEEDS_FORCE (REST setErrorHandler) / CONFLICT (tRPC mapSshError).
- tRPC ssh.krl.purgeCert; REST DELETE /api/v1/ssh/certs/:id?force=&dropRevocation= with a long OpenAPI description explaining the credential/KRL model; parity map entry added.
- ssh.cert.purge added to AuditOperation union.

Frontend (ssh.users.tsx): per-cert Purge button + state-aware confirm dialog (PurgeDialogBody) that explains pure vs preserve vs dropRevocation and offers the dropRevocation checkbox only for revoked+still-valid certs.

NOTE: not yet committed or deployed — awaiting review. Complementary to the peer's proposed host-level DELETE /ssh/hosts/:id (decommission), which is a separate op.
<!-- SECTION:NOTES:END -->
