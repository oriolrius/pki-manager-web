---
id: TASK-228
title: 'ZONE-11: Frontend zone switcher, zone filters and zone management page'
status: To Do
assignee: []
created_date: '2026-09-01 04:50'
updated_date: '2026-09-01 06:03'
labels:
  - ssh-zones
  - ssh-cert-manager
  - frontend
  - ui
milestone: SSH Zones
dependencies:
  - TASK-223
ordinal: 55014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Give the SSH section a zone switcher, so an operator can see CAs, hosts, users and KRLs for one trust domain at a time -- the requirement that motivated decision-017.

Shape (decision-017 section 8): a persisted switcher in the SSH sub-nav with an explicit "All zones" option; list pages filter by it and grow a Zone column when "All zones" is selected; create forms require a zone, prefilled from the switcher; a new management page.

Files and what changes in each:

- frontend/src/routes/ssh.tsx -- the layout route. Add `validateSearch` for a `zone` search param so every child route inherits it, and render the switcher next to SUB_NAV (line 37-52). Persist the last choice to localStorage and seed the param from it on first load; the URL wins when present, so a link is shareable. SshLanding's getting-started checklist (lines 69-117) currently asks "does an active user CA exist anywhere" -- it must ask that of the selected zone, otherwise a fresh second zone shows as already set up.
- frontend/src/routes/ssh.cas.tsx, ssh.hosts.tsx, ssh.users.tsx, ssh.krl.tsx, ssh.principals.tsx -- pass zoneId into the list queries (trpc.ssh.ca.list, ssh.host.list, ssh.user.listIdentities / listCertificates, ssh.principal.list / staleHosts, ssh.block.fleetDistribution); render a Zone column only in the "All zones" view.
- frontend/src/routes/ssh.cas.new.tsx -- it already uses validateSearch for `caType` (line 9-12); add `zone` the same way and a zone select prefilled from the switcher. Its CA Type select (line 63-70) should say which zone the CA will be created in, because "one active CA per type" is now per zone.
- frontend/src/routes/ssh.hosts.new.tsx and ssh.users.new.tsx -- zone select, prefilled, required.
- frontend/src/routes/ssh.cas.$id.tsx and ssh.hosts.$id.tsx -- show the owning zone in the header card.
- NEW frontend/src/routes/ssh.zones.tsx -- list zones with their CA/host/identity counts, create, rename, archive/un-archive. Add it to SUB_NAV; per TASK-211 the nav order is deliberate, so place Zones first (it is the container everything else lives in).

House style, from the existing SSH pages: hand-written Tailwind, no component library beyond frontend/src/components/ui, lucide icons, confirm()/prompt() gates for destructive actions, STATUS_STYLES pills. Follow it rather than introducing a new pattern.

Archived zones stay visible in the switcher only when they are the current selection or "show archived" is toggled, and creation forms refuse them (the server already does, per TASK-219 -- the UI should not offer the option in the first place).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An operator can switch the SSH section between zones and see only that zone's CAs, hosts, users, principals and KRLs
- [x] #2 The selected zone survives a page reload and is carried in the URL so a link opens on the same zone
- [x] #3 An All-zones view exists and shows which zone each row belongs to
- [x] #4 Creating a CA, host or identity requires choosing a zone, prefilled from the switcher, and archived zones are not offered
- [ ] #5 A zone can be created, renamed, archived and un-archived from a management page in the SSH section
- [ ] #6 The getting-started checklist on the SSH landing page reflects the selected zone rather than the whole installation
- [ ] #7 Frontend tests and typecheck pass, and the change is verified in a running browser with two zones configured
<!-- AC:END -->









## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a small useZone() hook (frontend/src/lib or components/ssh) wrapping the search param + localStorage, exposing { zoneId, zoneSlug, isAll, setZone } and the zone list query.
2. ssh.tsx: validateSearch for `zone`; render the switcher; make SshLanding's five checks zone-aware; add the Zones entry to SUB_NAV.
3. Thread zoneId into every list query listed above; add the conditional Zone column.
4. Zone selects on the three create forms; show the target zone in confirmation copy where a mistake is expensive (CA creation, host registration).
5. New ssh.zones.tsx route -- the router plugin regenerates routeTree.gen.ts, do not hand-edit it.
6. Tests: extend the frontend Vitest+RTL suites for the changed pages -- switching zones refetches with the new filter; the Zone column appears only in the All-zones view; a create form blocks submission without a zone; the landing checklist reflects the selected zone.
7. Update tests/screenshots.spec.ts if the SSH nav shot changes; run pnpm --filter frontend test and pnpm typecheck.
8. Verify in the browser through the Orca CLI (dev stack per DEVELOPMENT.md) with two real zones, not only in tests.
<!-- SECTION:PLAN:END -->
