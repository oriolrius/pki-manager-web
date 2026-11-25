---
id: TASK-186
title: >-
  BLK-09: UI — Host Access card + Users blocked-on pills + KRL distribution
  columns
status: Done
assignee:
  - '@myself'
created_date: '2026-07-03 21:26'
updated_date: '2026-07-03 23:17'
labels:
  - ssh-host-blocks
  - frontend
milestone: SSH Host Access Blocks
dependencies:
  - TASK-185
references:
  - frontend/src/routes/ssh.hosts.$id.tsx
priority: medium
ordinal: 13014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Existing conventions only: handmade Tailwind, confirm()/prompt() gates, alert() feedback, lucide icons, STATUS_STYLES pills, TanStack Query invalidation patterns.

HOST DETAIL (ssh.hosts.$id.tsx): new Access card between the header card and DeployPanel. Entitlement table (identity / via-roles -> local accounts / by,when / state) from ssh.host.access, per-row [Block]; blocked identities render as red rows with reason/by/when/state pill + [Unblock]; "Block user…" dropdown for pre-emptive blocks on identities not currently entitled.

BLOCK CONFIRM — exact decision copy: "Block <identity> on <fqdn>? Access to all other hosts is unaffected." + optional prompt() reason. Shared-key over-block warning when the API reports a fingerprint collision: "this key is also certified for <other> — blocking will deny both on this host". HARD warning when the host is not on a per-host channel (Unknown/unenforceable state): "this host fetches the per-CA KRL — the block will NOT be enforced until it is switched".

STATE PILLS: Effective green / Pending yellow / Lifting yellow / Unknown gray; tooltip verbatim: "served to host puller at <time> — not confirmation of install". Superseded-by-offboard annotation rendered on affected rows. Unblock is symmetric: show Lifting until the post-lift version lands — never claim access restored while the host enforces the old KRL.

USERS PAGE (ssh.users.tsx): expanded IdentityCard gains a "Blocked on:" row of red host pills (each with state) + a "Block on host…" select.

KRL PAGE (ssh.krl.tsx): HostDistribution table gains Blocks (count) and State columns — the fleet-wide propagation view.

The admin never sees serials, fingerprints, or KRL mechanics.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All three surfaces implemented per decision-016 UI spec, including exact confirm copy, optional reason prompt, over-block warning, and the non-enforceable-channel hard warning
- [x] #2 State pills + honest tooltip; Lifting shown after unblock until version match; superseded-by-offboard annotation visible
- [x] #3 Component tests: state pill derivation, confirm flows, warnings, query invalidation after block/unblock
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
New frontend/src/components/ssh/: host-krl-state.ts (stateLabel/statePillClasses/stateTooltip - green Effective, yellow Pending/Lifting, gray Unknown, unsigned cause appended), HostKrlStatePill.tsx (title tooltip with pinned honesty copy), block-flows.ts (DI blockFlow/unblockFlow holding the EXACT decision confirm copy + over-block + hard channel warnings; optional prompt reason; alert feedback naming Pending/Lifting), HostAccessCard.tsx (access table identity/via-as/by-when/state, red blocked rows, superseded-by-offboard + disabled annotations, pre-emptive dropdown). Routes: ssh.hosts.$id.tsx renders HostAccessCard between header and DeployPanel (hidden for offboarded); ssh.users.tsx IdentityCard expanded shows Blocked-on pills (fqdn + state, superseded tag) + Block-on-host select using fleet state for the channel warning; ssh.krl.tsx HostDistribution switched to ssh.block.fleetDistribution with Blocks + State columns. Backend: ssh.block.collisions tRPC query + GET /identities/:id/collisions REST twin (pre-confirm over-block check). Tests: host-access.test.tsx 10/10 (pill derivation incl. render, tooltip honesty/unsigned, exact confirm copy, both warnings, block flow with collision-in-confirm + reason + invalidation, declined confirm, cancelled prompt still blocks, API failure path, symmetric unblock). Frontend typecheck clean; frontend suite 37/37; backend typecheck clean.
<!-- SECTION:NOTES:END -->
