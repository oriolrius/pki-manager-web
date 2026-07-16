---
id: TASK-213
title: 'SSH host detail: map principals to local accounts from the host page'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-07-16 05:22'
updated_date: '2026-07-16 05:26'
labels:
  - frontend
  - ssh
  - ux
dependencies: []
ordinal: 40014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On /ssh/hosts/$id (frontend/src/routes/ssh.hosts.$id.tsx) there is no way to see or change which principals grant login on the host. Today that means leaving for /ssh/principals and finding the host again. Add a card below the Access card (HostAccessCard) with a principal selector plus local-account field, mapping principals to accounts for this host and showing the rendered auth_principals files. Reuses the ssh.principal.map / render / markPushed tRPC procedures already backing the Principals page; consider extracting the mapping form shared with TASK-212 rather than duplicating it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Host detail shows the host's current principal-to-account mappings below the Access card
- [ ] #2 User can map a principal to a local account on that host by selecting from existing principals
- [ ] #3 The rendered /etc/ssh/auth_principals/<account> file contents are shown and copyable
- [ ] #4 A host needing a push shows the stale signal and can be marked pushed from this page
<!-- AC:END -->
