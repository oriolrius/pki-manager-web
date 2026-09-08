---
id: TASK-233
title: SSH cert purge — hard-delete a mis-issued certificate (UI + REST + tRPC)
status: To Do
assignee: []
created_date: '2026-09-08 04:48'
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
- [ ] #1 Admin can purge an active (never-revoked), non-expired cert and it disappears with zero KRL change; the serial can be re-issued
- [ ] #2 Purging a revoked, still-valid cert without force returns 409; with force (default) the serial is preserved in the KRL via a serial directive; with force+dropRevocation the serial is removed from the KRL
- [ ] #3 Every purge writes an ssh.cert.purge audit_log row (serial, reason, operator, whether KRL was regenerated); a second purge of the same id is 404, never 500
- [ ] #4 Operation is exposed over both tRPC (ssh.krl.purgeCert) and REST (DELETE /api/v1/ssh/certs/:id) with rich OpenAPI + UI help text explaining pure vs preserve vs dropRevocation
<!-- AC:END -->
