---
id: TASK-132
title: >-
  SSH-14: ssh-principal.service.ts: principal catalog + host→account map +
  auth_principals rendering + drift awareness
status: To Do
assignee: []
created_date: '2026-06-29 15:41'
updated_date: '2026-06-29 15:47'
labels:
  - ssh-cert-manager
  - backend
  - services
milestone: SSH Certificate Manager
dependencies:
  - TASK-125
  - TASK-123
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Singleton service owning the RBAC catalog: CRUD over ssh_principals (role names), ssh_user_principals (which roles an identity may encode), and ssh_host_principal_maps (principal→local-account per host/host-group). render(hostId) returns the exact /etc/ssh/auth_principals/<account> file contents per local account plus the AuthorizedPrincipalsFile sshd_config directive, for automation to push. Validates principal/account names against an injection-safe grammar. Adding a host to a group inherits mappings with no cert re-signing. DRIFT AWARENESS: flags hosts whose principal maps changed in the catalog AFTER their last automation push (using ssh_hosts.last_principal_push_at from SSH-06), surfacing 'principal files stale' rather than silently diverging; reconciliation itself remains the automation layer's job.

**Epic:** SSH CA & Signing Services
**Logical deps:** SSH-08, SSH-06
**Touchpoints:** backend/src/services/ssh-principal.service.ts, backend/src/services/ssh-principal.service.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can define role-principals and map them to local accounts (e.g. 'admin'→'root') scoped per host or host-group
- [ ] #2 render(hostId) returns the exact /etc/ssh/auth_principals/<account> file contents and the AuthorizedPrincipalsFile directive snippet for that host
- [ ] #3 Adding a host to a group makes it inherit the group's principal→account mappings with no certificate re-signing; changing a mapping writes an audit_log row and updates the catalog's change timestamp
- [ ] #4 Hosts whose catalog mappings changed after last_principal_push_at are flagged as 'stale'; principal and account names are validated against an injection-safe grammar
<!-- AC:END -->
