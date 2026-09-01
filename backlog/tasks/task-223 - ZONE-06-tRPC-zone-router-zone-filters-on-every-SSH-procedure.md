---
id: TASK-223
title: 'ZONE-06: tRPC zone router + zone filters on every SSH procedure'
status: To Do
assignee: []
created_date: '2026-09-01 04:47'
labels:
  - ssh-zones
  - ssh-cert-manager
  - backend
  - api
  - trpc
milestone: SSH Zones
dependencies:
  - TASK-221
ordinal: 50014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose zones over tRPC -- the API the frontend consumes -- and let every SSH list procedure filter by zone.

New `zone` sub-router in backend/src/trpc/procedures/ssh.ts (or a sibling procedures/zone.ts mounted on the root router; prefer ssh.zone.* for now since only SSH entities carry a zone, and decision-017 defers X.509 adoption):
  zone.list({ includeArchived? })  -- sshProtectedProcedure
  zone.get({ idOrSlug })           -- sshProtectedProcedure
  zone.create({ name, displayName, description? })  -- sshAdminProcedure
  zone.update({ id, displayName?, description? })   -- sshAdminProcedure
  zone.archive({ id }) / zone.unarchive({ id })     -- sshAdminProcedure

Guard choice matters and follows the existing convention documented at the top of ssh.ts: "CA management uses sshAdminProcedure (admin + fail-closed when OIDC off, SSH-34); issuance/reads use sshProtectedProcedure". A zone is trust-domain configuration, strictly more privileged than issuing a cert, so mutations are sshAdminProcedure.

Existing procedures gaining an optional `zoneId`:
  ca.list, ca.trustAnchors, host.list, user.listIdentities, user.listCertificates,
  principal.list, principal.mappingsByPrincipal, principal.staleHosts,
  bulk.expiring, mon.metrics
Creation procedures gaining an optional `zoneId` (resolved by resolveZone, so single-zone callers may omit it):
  ca.create, ca.import, host.register, user.createIdentity, principal.create, token.mint

Zod schemas live in backend/src/trpc/ssh-schemas.ts, which is the single source of truth for BOTH tRPC validation and the OpenAPI spec (zod-to-json-schema) -- so getting the schemas right here is most of TASK-224's work too.

Error mapping: SshZoneNotFoundError -> NOT_FOUND, SshZoneAmbiguousError / SshZoneArchivedError / SshZoneMismatchError -> BAD_REQUEST, SshZoneExistsError -> CONFLICT, added to mapSshError() (ssh.ts:43-55).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Zones can be listed, created, renamed, archived and un-archived over tRPC
- [ ] #2 Zone mutations require an admin, matching how CA management is already guarded
- [ ] #3 Every SSH list procedure can be filtered to one zone, and returns all zones when no filter is given
- [ ] #4 CAs, hosts, identities and principals can be created into an explicitly named zone
- [ ] #5 An unknown zone returns not-found and an ambiguous omitted zone returns a bad-request naming the available zones
- [ ] #6 Existing frontend tRPC calls that pass no arguments still compile and behave as before
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ssh-schemas.ts: zoneSlugSchema (^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$), createZoneSchema, updateZoneSchema, zoneIdSchema, zoneRefSchema (id or slug); add `.extend({ zoneId: z.string().min(1).optional() })` to createSshCaSchema, importSshCaSchema, registerHostSchema, createIdentitySchema, createPrincipalSchema, mintTokenSchema; add a shared zoneFilterSchema for the list inputs.
2. procedures/ssh.ts: add the zoneRouter, register it on sshRouter (line 429), thread inputs into the service calls, extend mapSshError.
3. Note the list procedures that currently take NO input at all (ca.list line 60, host.list line 112, user.listIdentities line 187, principal.list line 247) -- adding an optional input object is backwards-compatible for tRPC clients but the frontend calls them as `useQuery()` with no argument; keep the input `.optional()` so those calls keep compiling (TASK-228 updates them).
4. Tests: extend trpc/procedures/ssh.integration.test.ts (or add ssh-zone-api.test.ts) -- zone CRUD round trip, admin guard on mutations, zoneId filters return only that zone's rows, an unknown zone yields NOT_FOUND, an ambiguous omitted zone yields BAD_REQUEST.
5. pnpm typecheck (frontend too -- the tRPC types are shared) + backend suite.
<!-- SECTION:PLAN:END -->
