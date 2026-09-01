---
id: TASK-226
title: 'ZONE-09: External/fleet API zone scoping + ECIES FQDN disambiguation'
status: To Do
assignee: []
created_date: '2026-09-01 04:49'
updated_date: '2026-09-01 05:41'
labels:
  - ssh-zones
  - ssh-cert-manager
  - backend
  - api
  - external
  - security
milestone: SSH Zones
dependencies:
  - TASK-221
ordinal: 53014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make the automation API zone-aware. Two distinct problems, one file (backend/src/rest/routes/ssh-external.routes.ts).

== 1. Token-authenticated routes: the token's zone is authoritative ==

ssh_fleet_tokens gains zone_id in TASK-218; ssh-fleet-token.service.ts mint() (line 68-77) must require it, and validate that userCaId/hostCaId belong to it. VerifiedToken and FleetTokenDto carry the zone.

The dangerous part is the two upserts, which today look entities up by natural key across the whole installation:
  - sign-host (line 119): `select ssh_hosts where fqdn = body.fqdn` -- with (zone_id, fqdn) uniqueness this can return a host from ANOTHER zone, and the route then re-keys and re-certifies it. Must become a (token.zoneId, fqdn) lookup, and the register() it falls back to must create the host in the token's zone.
  - sign-user (line 168): `select ssh_identities where subject = body.subject` -- same problem, same fix against (token.zoneId, subject).
Also line 317: the legacy per-CA ECIES fallback resolves `caType='host' AND status='active'` installation-wide; scope it to the host's zone.
register-host-pubkey (line 220) and hosts/:fqdn/auth-principals (line 243) look hosts up by fqdn alone; both are token-authenticated so both scope to token.zoneId.

== 2. POST /krl: the unauthenticated route that cannot use a token (amendment A2) ==

POST /api/v1/external/ssh/krl deliberately has NO app auth -- ECIES is the authentication, and the 404-vs-200 host oracle is an accepted, bounded disclosure. It resolves the host from `host_id` (the FQDN) in the body at line 280. Once FQDNs are unique only per zone, that lookup is ambiguous.

Pinned resolution:
  - the body accepts an optional `zone` (slug)
  - `zone` given            -> resolve (zone, fqdn)
  - omitted, one match      -> serve it  (every single-zone install, and every multi-zone install with distinct FQDNs, is unaffected)
  - omitted, several matches-> 409 AMBIGUOUS_HOST, message naming the candidate zones
Serving an arbitrary candidate is not acceptable: the envelope is ECIES-encrypted to that row's host key, so the wrong host's krl-client fails decryption and fail-stales on its last-good KRL -- a silent, hard-to-diagnose outage of revocation and block propagation.

TASK-227 adds the matching --zone flag to krl-client.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A fleet token belongs to one zone and can only sign, adopt or re-key entities inside it
- [x] #2 Automation signing a host or user whose name also exists in another zone creates or updates the entity in the token's own zone, never the other zone's
- [x] #3 Minting a token with CAs from a different zone than the token is refused
- [ ] #4 A host pulling its encrypted KRL without naming a zone still succeeds whenever its FQDN is unambiguous
- [ ] #5 A host pulling its encrypted KRL when its FQDN exists in several zones gets a clear ambiguity error instead of another zone's envelope
- [ ] #6 A host that names its zone receives an envelope only its own key can decrypt
<!-- AC:END -->







## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ssh-fleet-token.service.ts: zoneId on mint (resolveZone + assertWritable), validate the CA pair belongs to it, carry it on VerifiedToken and FleetTokenDto, and expose it in the tRPC/REST token routes.
2. ssh-external.routes.ts: scope the four token-authenticated lookups to token.zoneId; pass the zone into getSshHostService().register() and getSshUserService().createIdentity(); scope the line-317 CA fallback to the host's zone.
3. POST /krl: extend the body schema with `zone`; implement the three-way resolution; add AMBIGUOUS_HOST to the error vocabulary next to NOT_FOUND / NO_KRL / RATE_LIMITED and document it in the route's OpenAPI summary.
4. Do NOT declare a JSON response schema on POST /krl -- the success payload is a binary ECIES envelope and fast-json-stringify would corrupt it (existing comment at the route).
5. Tests (extend ssh-external.integration.test.ts and ssh-ecies.integration.test.ts):
   - a token scoped to zone A cannot sign for, adopt or re-key a host or identity that lives in zone B
   - sign-host with an FQDN that exists in another zone creates a NEW host in the token's zone rather than hijacking the existing one
   - sign-user with a subject that exists in another zone creates a new identity in the token's zone
   - POST /krl with one match and no zone still serves (backwards compatibility)
   - POST /krl with the same FQDN in two zones and no zone returns 409 AMBIGUOUS_HOST
   - POST /krl with the zone named serves the right envelope, decryptable by that host's key only
   - minting a token whose CA pair is from another zone is refused
6. pnpm typecheck + full backend suite; smoke against the dev backend with a real fleet token.
<!-- SECTION:PLAN:END -->
