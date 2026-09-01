---
id: TASK-222
title: >-
  ZONE-05: Narrow the composed per-host KRL to the host's zone (trust boundary
  enforcement)
status: To Do
assignee: []
created_date: '2026-09-01 04:47'
updated_date: '2026-09-01 05:29'
labels:
  - ssh-zones
  - ssh-cert-manager
  - backend
  - krl
  - security
milestone: SSH Zones
dependencies:
  - TASK-221
ordinal: 49014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The security core of the milestone: make the zone an actual trust boundary in the artifact hosts install, not just a label in the database.

backend/src/services/ssh-host-krl.service.ts generateInner() composes each host's KRL as:

    KRL(host Y) = host-CA revocation set
                  U  ALL user-CA revocation sets          <-- line 107: allCas.filter(c => c.status !== 'retired')
                  U  resolve(active blocks on Y)

That union is taken over EVERY non-retired CA in the installation. It was correct when there was exactly one User CA; with zones it means a staging host installs a KRL describing production's user certificates, and -- worse in the other direction -- the composition of a host's deny list stops being a property of its own trust domain. Narrow the union to CAs whose zone_id equals the host's zone_id.

Two things must NOT change:

1. `ssh_krl_seq` (db/schema.ts:509, allocated by db/krl-seq.ts) stays a SINGLE GLOBAL allocator. decision-016 pinned requirement #4 and the krl-client anti-rollback check compare the CA-signed header number strictly; a per-zone sequence would let a host see a lower number after any lineage change and reject the KRL as a rollback. Add a test that asserts the allocator is not partitioned.

2. The per-CA KRL lineage (ssh-krl.service.ts, table ssh_krls) is already keyed by ca_id and therefore already per-zone. It needs no change -- only a test proving it.

Also in scope, because it is the operator's view of the same boundary:
- resolveHostCa() (line 242-256) picks the signing Host CA for the composed KRL: its fallback `where(caType='host' AND status != 'retired')` must be scoped to the host's zone, otherwise a multi-zone install signs a host's KRL with a foreign zone's Host CA and every krl-client on that host fails signature verification (exit 4) and fail-stales on its last-good KRL -- a silent fleet-wide outage of block and revocation propagation.
- ssh-mon.service.ts metrics() (lines 34-77): counts are installation-wide. Add an optional zone filter and per-zone breakdown so "krlsPastNextUpdate" is actionable when several zones exist.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A host's KRL contains revocations from its own zone only, verified by decoding the actual KRL bytes
- [x] #2 A host's KRL is signed by a Host CA from its own zone, and that signature does not verify against another zone's Host CA key
- [x] #3 Per-host access blocks keep working within a zone exactly as they did before
- [x] #4 KRL numbers remain strictly increasing across all hosts regardless of zone, so no client rejects a KRL as a rollback
- [x] #5 The per-CA KRL of one zone never contains a serial issued in another zone
- [ ] #6 On a single-zone installation the composed KRL bytes are unchanged
- [ ] #7 SSH monitoring metrics can be read per zone as well as installation-wide
<!-- AC:END -->











## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ssh-host-krl.service.ts generateInner(): load the host row first (already done at line 77), then build `allCas` filtered by `eq(sshCas.zoneId, host.zoneId)`; keep the existing `status !== 'retired'` union filter on top. Retired same-zone CAs must still contribute block serials (the existing comment at step 2a explains why) -- verify that path still works after the filter, since caById is also used for the retired lookup.
2. resolveHostCa() (line 242): add the zone predicate to the fallback query; keep the "host's own lineage via its current cert" branch first, but assert that cert's CA is in the host's zone (it must be, after TASK-221 -- a mismatch is a data bug and should throw rather than sign).
3. ssh-mon.service.ts: optional zoneId on metrics(); add a per-zone breakdown array to SshMetrics.
4. Tests (extend ssh-host-krl.service.test.ts and ssh-krl-triggers.test.ts, or add a ssh-zone-krl.test.ts):
   - two zones, a revoked user cert in zone A: decode the composed KRL bytes for a zone-B host (src/test/krl-decode.ts) and assert zone A's serial is ABSENT; assert a zone-B revocation IS present
   - a zone-B host's composed KRL is signed by zone B's Host CA (verify the detached signature against zone B's key, and assert it does NOT verify against zone A's)
   - blocks still resolve within a zone exactly as decision-016 specifies
   - krl_number remains strictly increasing across hosts in DIFFERENT zones (the global allocator test)
   - the per-CA ssh_krls lineage for zone A contains no zone-B serial
5. pnpm typecheck + full backend suite (ssh-host-krl, ssh-krl-triggers, ssh-block, ssh-mon suites are the ones at risk).
<!-- SECTION:PLAN:END -->
