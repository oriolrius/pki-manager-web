---
id: TASK-125
title: 'SSH-08: Schema: principal catalog + host principal-maps (RBAC source of truth)'
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
Add the three RBAC tables. ssh_principals (id, name unique e.g. 'admin','deployer', description) is the role catalog and picklist. ssh_user_principals (identity_id FK cascade, principal_id FK restrict, unique on the pair) records which principals an identity's certs may carry. ssh_host_principal_maps (host_id FK cascade, principal_id FK restrict, local_account, unique on the triple) is the per-host principal→local-account mapping the automation lens renders into /etc/ssh/auth_principals/%u. This separates 'role a person holds' from 'role→account mapping on a box' so adding a host needs only principal files, no re-signing.

**Epic:** SSH Data Model & Migrations
**Logical deps:** SSH-06
**Touchpoints:** backend/src/db/schema.ts, backend/src/db/migrations/
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The migration creates ssh_principals, ssh_user_principals, ssh_host_principal_maps with the FKs, cascade/restrict rules, and unique indexes described
- [ ] #2 A query can answer 'who can become root on host H' and 'which auth_principals files does host H need' without schema change
- [ ] #3 Deleting an identity cascades its ssh_user_principals, deleting a host cascades its ssh_host_principal_maps, and deleting an in-use principal is restricted
- [ ] #4 Exported types for all three tables; migration applies cleanly; typecheck passes
<!-- AC:END -->
