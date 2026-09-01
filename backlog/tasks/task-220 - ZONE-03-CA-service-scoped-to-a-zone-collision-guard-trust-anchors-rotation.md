---
id: TASK-220
title: >-
  ZONE-03: CA service scoped to a zone (collision guard, trust anchors,
  rotation)
status: To Do
assignee: []
created_date: '2026-09-01 04:46'
updated_date: '2026-09-01 05:28'
labels:
  - ssh-zones
  - ssh-cert-manager
  - backend
  - service
milestone: SSH Zones
dependencies:
  - TASK-219
ordinal: 47014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the SSH CA service zone-aware. This is the smallest of the service tasks but it is the one that turns "one User CA and one Host CA, ever" into "one User CA and one Host CA per zone".

Exact call sites in backend/src/services/ssh-ca.service.ts:

- create() line 77-81 -- the pre-KMS guard queries `where(caType = params.caType AND status = 'active')` across the whole installation and throws SshCaExistsError. It must become zone-scoped, and the error message ("an active user SSH CA already exists (one active CA per type)") must name the zone, otherwise an operator creating the second zone's User CA gets a message that looks like a bug.
- import() line 139-143 -- identical guard, same fix.
- create()/import() must persist zone_id, resolved through resolveZone() from TASK-219.
- list() line 179-181 -- returns every CA; gains an optional zone filter.
- getTrustAnchors() line 193-200 -- currently reads EVERY row and partitions active+rotating into userCaKeys/hostCaKeys. This is the function behind /ssh/trusted-user-ca-keys, /ssh/host-ca-keys, /ssh/cert-authority and the host deploy bundle. It must take a zone and return only that zone's anchors. Publishing another zone's User CA into a host's TrustedUserCAKeys is precisely the trust leak this milestone closes.
- rotate() line 208-232 -- creates the successor via this.create(); the successor MUST inherit the predecessor's zone, not resolve one implicitly, or a rotation on a multi-zone install lands the new CA in the wrong zone (or throws SshZoneAmbiguousError, which would be a nasty surprise mid-rotation).
- SshCaDto gains the zone (id + slug) so the UI can render a Zone column without a second query.

Rotation, retire and revoke semantics themselves are unchanged -- decision-017 preserves SSH-32a verbatim, just scoped.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each zone can hold its own active User CA and Host CA, created through the normal CA creation flow
- [x] #2 Attempting a second active CA of the same type in the same zone is refused with a message that names the zone
- [ ] #3 The published trust anchors for a zone contain only that zone's CA keys and never another zone's
- [ ] #4 Rotating a CA produces a successor in the same zone as its predecessor
- [ ] #5 CAs can be listed for one zone or across all zones, and each CA reports which zone it belongs to
- [ ] #6 On a single-zone installation every CA operation behaves exactly as it did before
<!-- AC:END -->





## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ssh-ca.service.ts: add zoneId to SshCaDto and toDto(); thread a zone through create/import via resolveZone() + assertWritable(); add zoneId to both collision guards; give SshCaExistsError a zone argument and rewrite its message to "an active <type> SSH CA already exists in zone '<slug>' (one active CA per type per zone)".
2. list(ctx, { zoneId? }) -- filter when given, return all otherwise (the "All zones" view).
3. getTrustAnchors(ctx, { zoneId? }) -- resolve via resolveZone() so a single-zone install can keep calling it with no argument; filter the CA rows by zone before partitioning.
4. rotate(): read old.zoneId and pass it explicitly into this.create(); assert in a test that the successor's zone equals the predecessor's.
5. Update every caller of getTrustAnchors: ssh-host.service.ts buildHostDeployBundle (pass host.zoneId), rest/routes/ssh.routes.ts /trust-anchors, rest/routes/ssh-public.routes.ts (TASK-225 owns the route shape; here just keep it compiling by passing the default zone).
6. Tests: two zones each get their own active user CA; the second in one zone is rejected with a zone-naming message; getTrustAnchors(zoneA) never contains zone B's key; rotate keeps the zone; list filters.
7. pnpm typecheck + backend suite.
<!-- SECTION:PLAN:END -->
