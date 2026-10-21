---
id: TASK-213
title: 'SSH host detail: map principals to local accounts from the host page'
status: Done
assignee:
  - '@myself'
created_date: '2026-07-16 05:22'
updated_date: '2026-07-16 05:37'
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
- [x] #1 Host detail shows the host's current principal-to-account mappings below the Access card
- [x] #2 User can map a principal to a local account on that host by selecting from existing principals
- [x] #3 The rendered /etc/ssh/auth_principals/<account> file contents are shown and copyable
- [x] #4 A host needing a push shows the stale signal and can be marked pushed from this page
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reuse components/ssh/HostPrincipalMappingCard.tsx (extracted in TASK-212).
2. Render it on /ssh/hosts/$id below HostAccessCard, hidden for offboarded hosts.
3. Stale signal + Mark pushed + rendered auth_principals files come from the shared card.
4. Typecheck + tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added a Principals card to /ssh/hosts/$id, rendered directly below HostAccessCard (hidden for offboarded hosts, matching the Access card).

Rather than duplicating the mapping form it reuses components/ssh/HostPrincipalMappingCard.tsx extracted in TASK-212 — the same principal selector, local-account field, rendered auth_principals files (with the ConfigSnippet copy/download buttons), stale pill and Mark pushed button, backed by the existing ssh.principal.map / render / markPushed procedures. Only the heading differs (a static 'Principals' title plus the host FQDN as subtitle).

Also made the deploy panel's own Mark pushed invalidate principal.staleHosts, so the two stale signals on this page can't disagree.

Verified in the dev stack (:52080) on bastion-01: the card renders below Access showing the existing deployer mapping; mapping monitoring -> monitor from this page rendered /etc/ssh/auth_principals/monitor and raised the stale pill; Mark pushed cleared both the card pill and the deploy panel's stale banner. Frontend typecheck clean, 52 tests pass.
<!-- SECTION:NOTES:END -->
