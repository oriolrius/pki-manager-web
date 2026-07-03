---
id: TASK-182
title: >-
  BLK-05: Issuance + revocation triggers — per-host KRL freshness
  (correctness-critical)
status: Done
assignee: []
created_date: '2026-07-03 21:25'
updated_date: '2026-07-03 22:51'
labels:
  - ssh-host-blocks
  - backend
  - revocation
milestone: SSH Host Access Blocks
dependencies:
  - TASK-180
references:
  - backend/src/services/ssh-cert.service.ts
priority: high
ordinal: 9014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Regeneration stays OFF the issuance hot path (pinned req #3).

1. ISSUANCE hook in SshCertService.sign (type=user) — verified the single choke point: UI issue (ssh-user.service.ts -> sign), bulkRenew (SshBulkService -> renew -> sign), external sign-user; all pass identityId. If the identity has active blocks: ASYNC regen of those hosts' KRLs (small affected set). Regen failure never fails issuance (failure audited).

2. REVOCATION: EVERY revoke entry point (revokeByCert for BOTH cert types, revokeBySerial, revokeByKeyFingerprint — ssh-krl.service.ts:56-104 — plus identity/host offboard loops) invalidates ALL per-host lineages CHEAPLY: clamp ssh_host_krls.next_update to now so the next pull lazily regenerates a fresh composition; eager regen ONLY for hosts holding active blocks. NOT an O(fleet) KMS signRaw loop on the revoke hot path. Without this, the BLK-06 cutover regresses revocation latency from sync-regen + <=15-min pull to the 1h nextUpdate backstop — violating pinned req #2's intent. Identity offboard (SSH-32c) loops revokeByCert per cert: invalidation must coalesce, not multiply.

3. HARDENING (decision-016 data-model note): forbid keyId-based identity resolution for user certs — block resolution keys off ssh_certificates.identity_id ONLY (keyId stays caller-settable).

4. Lazy regen-on-fetch (nextUpdate past) remains the backstop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New user cert to a blocked identity triggers async regen of affected host KRLs on ALL paths (UI issue, bulkRenew, external sign-user); issuance never blocked by regen failure; failure audited
- [x] #2 Every revocation entry point clamps next_update on all per-host rows; hosts with active blocks regenerate eagerly; test asserts revocation-to-served latency is bounded by one pull, not the 1h nextUpdate
- [x] #3 Identity resolution for user certs provably ignores keyId (test: forged keyId cannot dodge block resolution)
- [x] #4 Offboard loops coalesce invalidation (no O(certs x hosts) regen storm)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SshHostKrlService gains invalidateAll (single UPDATE clamping fresh next_update rows), onRevocation (clamp + schedule eager regen of distinct active-block hosts, excluding offboarded), onUserCertIssued(identityId) (eager regen of hosts blocking that identity), all through a 100ms debounced coalescing drain (dirtyHosts set + flushEagerRegen test hook). Hooks: ssh-krl.service revokeByCert/revokeBySerial/revokeByKeyFingerprint call onRevocation via dynamic import (avoids static cycle); SshUserService.revoke (tRPC ssh.user.revoke path, flips status without regen) also hooks; offboard loops covered transitively. Issuance: SshCertService.sign fires void onUserCertIssued for type=user with identityId (single choke point: UI issue, bulkRenew, external sign-user); catch-all so regen failure never propagates. Tests 6/6 (src/services/ssh-krl-triggers.test.ts, KMS mocked): clamp-all + eager-only-blocked with new serial present in eager row; all three entry points clamp; offboard of 5 certs coalesces to <=2 regens with all serials present; async post-issuance regen (vi.waitFor); unblocked issuance untouched + trigger failure never fails issuance; forged keyId cannot dodge (9502 in, 9501 out). decodeKrl extracted to src/test/krl-decode.ts. Prior BLK suites 16/16 green; strict typecheck clean.
<!-- SECTION:NOTES:END -->
