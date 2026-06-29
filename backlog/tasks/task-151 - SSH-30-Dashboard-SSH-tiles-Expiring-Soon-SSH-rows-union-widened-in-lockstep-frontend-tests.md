---
id: TASK-151
title: >-
  SSH-30: Dashboard SSH tiles + Expiring-Soon SSH rows (union widened in
  lockstep) + frontend tests
status: To Do
assignee: []
created_date: '2026-06-29 15:45'
labels:
  - ssh-cert-manager
  - frontend
milestone: SSH Certificate Manager
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend index.tsx with SSH stat tiles (active SSH host certs, active user identities, SSH certs expiring soon) using the existing stats-card markup. For Expiring Soon, prefer a SEPARATE SSH-only dashboard query to keep domains decoupled; if instead the shared expiringSoon discriminated union (backend dashboard.ts z.enum + frontend badge switch — already widened once for 'Dual (mTLS)' in commit 5ff38e9) is reused, it MUST be widened in lockstep on both sides with an explicit no-regression assertion for X.509/Dual rows (the exact failure mode of the prior dual-type bug). Add Vitest + RTL coverage for the load-bearing UX: ConfigSnippet copy/download, the capability editor's 'Harden' preset clearing extensions and force-command/source-address surfacing as critical options in the preview, principals→auth_principals file rendering, and KRL/distribution status rendering.

**Epic:** SSH Operator Console (Frontend)
**Logical deps:** SSH-27, SSH-28, SSH-29
**Touchpoints:** frontend/src/routes/index.tsx, backend/src/trpc/procedures/dashboard.ts, frontend/src/components/ConfigSnippet.test.tsx, frontend/src/components/SshCapabilityEditor.test.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The dashboard shows SSH host/user tiles styled consistently with existing tiles and the Expiring Soon view includes SSH rows with distinct type badges linking to SSH detail pages, with NO regression to existing X.509/Dual tiles/rows (asserted by a test)
- [ ] #2 Tests assert copying a config snippet writes the expected exact text and shows the copied state, and that the 'Harden' preset yields a preview with no permit-* extensions while toggling adds them
- [ ] #3 Tests assert force-command and source-address surface as critical options in the preview and a principal→account mapping renders the correct auth_principals file contents
- [ ] #4 Tiles/rows render loading/error/empty states gracefully and pnpm --filter frontend test passes in CI
<!-- AC:END -->
