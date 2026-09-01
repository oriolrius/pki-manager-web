---
id: TASK-221
title: >-
  ZONE-04: Host, identity and principal services scoped to a zone + cross-zone
  guards
status: To Do
assignee: []
created_date: '2026-09-01 04:46'
updated_date: '2026-09-01 05:29'
labels:
  - ssh-zones
  - ssh-cert-manager
  - backend
  - service
milestone: SSH Zones
dependencies:
  - TASK-220
ordinal: 48014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make every SSH entity carry a zone at creation, make every implicit CA resolver zone-scoped, and refuse every cross-zone combination. After this task no code path can sign a certificate with a CA from a different trust domain than its subject.

This is one task rather than three because the intermediate states are unsafe: `resolveUserCa` and `resolveHostCa` both end in `.limit(1)` over "active CA of this type". The moment a second zone exists and only half the resolvers are scoped, the unscoped half silently picks an arbitrary trust domain's CA. All resolvers move together.

== A. Entity creation gains a zone (resolved via resolveZone() from TASK-219) ==
- ssh-host.service.ts register() (~line 120-150) -- persist zone_id; the FQDN collision is now per zone.
- ssh-user.service.ts createIdentity() (line 61-85) -- persist zone_id; subject collision is now per zone.
- ssh-principal.service.ts createPrincipal() (line 50) -- persist zone_id; principal name collision is now per zone.
All three call assertWritable() so creation into an archived zone is refused.

== B. Implicit CA resolvers become zone-scoped ==
- ssh-host.service.ts resolveHostCa() (line 425-437): the `caId` branch must ALSO verify ca.zoneId === host.zoneId, not only ca.caType === 'host'. The fallback branch queries the active Host CA of the host's zone. Error text must name the zone ("no active Host CA in zone 'staging'").
- ssh-user.service.ts resolveUserCa() (line 246-258): same two changes against identity.zoneId.
- ssh-host.service.ts buildHostDeployBundle() (line 232): the `userCa` lookup that decides which User CA's KRL the host serves must use host.zoneId. Its getTrustAnchors() call passes host.zoneId (TASK-220 made that possible).

== C. Cross-zone invariant guards (defense in depth; each throws a typed error) ==
- ssh-principal.service.ts grantToIdentity() (line 111) -- identity.zoneId must equal principal.zoneId.
- ssh-principal.service.ts mapToHost() (line 128) -- host.zoneId must equal principal.zoneId.
- ssh-block.service.ts block() -- host.zoneId must equal identity.zoneId (a block is meaningless across a trust boundary the identity cannot cross anyway).
- ssh-cert.service.ts sign() -- the last line of defence: assert the resolved CA's zone equals the zone of hostId/identityId when either is supplied. Every issuance path funnels through here.

== D. Zone-filterable reads ==
list() / listIdentities() / listPrincipals() / mappingsByPrincipal() / staleHosts() / the ssh-bulk.service.ts expiring+renew+revoke selectors take an optional zoneId. Omitted means "all zones" for READS -- reads are not the dangerous direction, and the UI needs an "All zones" view.

== E. DTOs ==
SshHostDto, SshIdentityDto and PrincipalDto gain the zone (id + slug) so list pages can show a Zone column without a second round trip.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Hosts, identities and principals are created inside a zone and report which zone they belong to
- [ ] #2 A host certificate is always signed by a Host CA from that host's own zone, and a user certificate by a User CA from that identity's own zone
- [ ] #3 Passing a CA id from another zone into an issuance call is refused rather than honoured
- [ ] #4 A host's deploy bundle publishes only its own zone's User CA key
- [ ] #5 Granting a principal, mapping it to a host, or blocking an identity on a host is refused whenever the two entities live in different zones
- [ ] #6 Two hosts with the same FQDN in different zones each get a certificate from their own zone's CA
- [ ] #7 Hosts, identities, principals and certificates can be listed for one zone or across all zones
- [ ] #8 Every pre-existing backend test still passes without being edited
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ssh-host.service.ts: zone on register(); resolveHostCa() scoped + caId-branch zone check; buildHostDeployBundle() userCa lookup and getTrustAnchors() call use host.zoneId; list(ctx,{zoneId?}); hostDto() carries zone.
2. ssh-user.service.ts: zone on createIdentity(); resolveUserCa() scoped + caId-branch zone check; listIdentities(ctx,{zoneId?}); listCertificates gains an optional zoneId (join through ssh_cas); identityDto() carries zone.
3. ssh-principal.service.ts: zone on createPrincipal(); listPrincipals / mappingsByPrincipal / staleHosts zone filters; grantToIdentity + mapToHost cross-zone guards.
4. ssh-block.service.ts: cross-zone guard in block().
5. ssh-cert.service.ts: add the sign()-level assertion; introduce SshZoneMismatchError and map it to BAD_REQUEST in trpc/procedures/ssh.ts mapSshError.
6. ssh-bulk.service.ts: optional zoneId on the three selectors.
7. Tests -- one new test file for zone scoping plus additions to the existing service tests:
   - a host in zone B never receives a certificate signed by zone A's Host CA, even when zone A's CA id is passed explicitly
   - an identity in zone B never receives a certificate signed by zone A's User CA
   - the deploy bundle for a zone-B host contains zone B's User CA key and not zone A's
   - granting a zone-A principal to a zone-B identity is refused; mapping it to a zone-B host is refused; blocking a zone-A identity on a zone-B host is refused
   - same FQDN in two zones -> two distinct hosts, each certified by its own zone's CA
   - single-zone behaviour unchanged (existing tests must pass unedited)
8. pnpm typecheck + full backend suite.
<!-- SECTION:PLAN:END -->
