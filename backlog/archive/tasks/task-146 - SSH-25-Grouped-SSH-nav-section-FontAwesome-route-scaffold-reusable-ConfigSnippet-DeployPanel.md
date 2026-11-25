---
id: TASK-146
title: >-
  SSH-25: Grouped SSH nav section (FontAwesome), route scaffold, reusable
  ConfigSnippet/DeployPanel
status: Done
assignee: []
created_date: '2026-06-29 15:44'
updated_date: '2026-06-29 19:00'
labels:
  - ssh-cert-manager
  - frontend
milestone: SSH Certificate Manager
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add ONE grouped 'SSH' top-level entry to the nav in __root.tsx (using FontAwesome free-solid-svg-icons to match the existing fortawesome-only nav row, NOT lucide), routing to an SSH landing page with a second-level sub-nav (SSH CAs, Hosts, Users, Principals, Revocation/KRL) so the top bar stays ~6 items and X.509 vs SSH read as distinct domains. Scaffold the file-based routes following the list→/new→/$id + Outlet shape under _authenticated; the SSH section is empty-state-gated until at least one ssh_ca exists. Extract the proven copyToClipboard + monospace <code> overlay-button idiom (from certificates.tsx / cas.$id.tsx) into shared <ConfigSnippet> (title, caption, copy with Copy/Check state, optional Download-as-file — these MAY use lucide as they live inside pages) and <DeployPanel> (stacked snippets + headings + optional zip-bundle hook). routeTree.gen.ts regenerates via the router plugin.

**Epic:** SSH Operator Console (Frontend)
**Logical deps:** none
**Touchpoints:** frontend/src/routes/__root.tsx, frontend/src/routes/ssh.tsx, frontend/src/routes/ssh.cas.tsx, frontend/src/routes/ssh.hosts.tsx, frontend/src/routes/ssh.users.tsx, frontend/src/routes/ssh.principals.tsx, frontend/src/routes/ssh.krl.tsx, frontend/src/components/ConfigSnippet.tsx, frontend/src/components/DeployPanel.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An operator sees ONE 'SSH' nav entry (FontAwesome icon, matching the existing nav) that opens an SSH section with a second-level sub-nav (CAs/Hosts/Users/Principals/KRL); the top bar stays ~6 items and routes under the authenticated layout without a full reload, rendering /new and /$id via an Outlet
- [x] #2 A developer can render a labeled config block an operator copies with one click (transient 'Copied' confirmation) and optionally downloads as a named file (e.g. 10-ssh-ca.conf)
- [x] #3 ConfigSnippet/DeployPanel match existing visual conventions (bg-card, muted code background) and are keyboard-accessible; the SSH section is empty-state-gated until a CA exists
- [x] #4 routeTree.gen.ts regenerates cleanly and pnpm --filter frontend typecheck and build pass
<!-- AC:END -->
