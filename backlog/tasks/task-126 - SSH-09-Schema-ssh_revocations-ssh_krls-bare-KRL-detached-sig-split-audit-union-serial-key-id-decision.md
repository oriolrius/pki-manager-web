---
id: TASK-126
title: >-
  SSH-09: Schema: ssh_revocations + ssh_krls (bare-KRL + detached-sig split);
  audit-union + serial/key-id decision
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
Add ssh_revocations (ca_id, target_type 'cert'|'serial'|'key_fingerprint'|'key_id', cert_id nullable, serial nullable TEXT for uint64 safety, key_fingerprint nullable, reason, revoked_by, revoked_at) supporting both 'revoke a cert we issued' and emergency 'revoke a raw key/serial'; and ssh_krls (twin of crls: ca_id, krl_number monotonic, version_hash 'sha256:...' = ETag, krl_blob = the BARE UNSIGNED OpenSSH KRL that sshd reads via RevokedKeys, a DISTINCT ca_signature column holding the detached CA signature verified ONLY by the custom puller, this_update, next_update, revoked_count). The two-artifact split is settled HERE so SSH-20/21/22/24 do not re-litigate it. Extend AuditOperation/AuditEntityType unions in lib/audit.ts for all ssh.* operations (no audit_log migration — entity_type/entity_id are generic text). Record a backlog decision covering new-tables-vs-discriminator, on-row signed-blob (citing crls.crl_pem), the bare-KRL-unsigned-vs-detached-signature trust model, the per-CA serial allocator, and the key-id convention. SERIAL SCHEME: pick ONE scheme used consistently across UI and automation (do not mix monotonic counter with the PoC's unix-timestamp serials) and document that revoke-by-serial targets an explicit issued cert; range revocation is OUT of scope for v1 (the PoC revokes by key hash, and serial gaps make ranges an over-revocation foot-gun).

**Epic:** SSH Data Model & Migrations
**Logical deps:** SSH-05, SSH-07
**Touchpoints:** backend/src/db/schema.ts, backend/src/db/migrations/, backend/src/lib/audit.ts, backlog/decisions/decision-012 - SSH-Data-Model-and-KRL-State.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The migration creates ssh_revocations and ssh_krls with the listed columns; serials stored as TEXT (uint64-safe); ssh_krls has both krl_blob (bare unsigned KRL) and a distinct ca_signature column; composite index (ca_id, krl_number) and an index on version_hash
- [ ] #2 lib/audit.ts unions gain ssh_ca/ssh_host/ssh_identity/ssh_certificate/ssh_krl/ssh_principal entity types and ssh.ca.*, ssh.host.*, ssh.identity.*, ssh.cert.*, ssh.principal.*, ssh.krl.* operations, with no audit_log migration
- [ ] #3 A backlog decision (decision-012) records the new-tables choice, on-row blob choice, the bare-KRL-unsigned vs detached-signature trust model, ONE serial scheme used by both UI and automation, the per-CA monotonic allocator, the key-id convention, and that serial-range revocation is out of v1 scope
- [ ] #4 Exported SshRevocation/SshKrl types; migration applies cleanly; typecheck passes
<!-- AC:END -->
