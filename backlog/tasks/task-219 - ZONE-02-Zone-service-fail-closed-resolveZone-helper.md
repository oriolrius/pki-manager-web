---
id: TASK-219
title: 'ZONE-02: Zone service + fail-closed resolveZone() helper'
status: In Progress
assignee:
  - '@myself'
created_date: '2026-09-01 04:45'
updated_date: '2026-09-01 05:26'
labels:
  - ssh-zones
  - ssh-cert-manager
  - backend
  - service
milestone: SSH Zones
dependencies:
  - TASK-218
ordinal: 46014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the zone service and, more importantly, the ONE shared resolution helper every other task in this milestone calls.

Amendment A1 of decision-017 pins the rule, and it is the reason this milestone does not become a 33-file test rewrite:

  resolveZone(ctx, explicitZone?) ->
    explicit given : look up by id OR slug; not found -> SshZoneNotFoundError (404)
    omitted        : exactly ONE non-archived zone exists -> that zone
                     otherwise -> SshZoneAmbiguousError (400), message listing the slugs

backend/src/test/setup.ts migrates the real src/db/migrations folder, so the 'default' zone seeded by TASK-218 exists in every test database. With this rule every existing caller -- the 33 SSH test files, the sibling pki-manager-cli, the Galaxy oriolrius.pki_manager collection, the live pki.joor.net install -- keeps working with no change, and every un-scoped caller fails loudly and actionably the moment an operator creates a second zone. Defaulting to "the first zone" instead would silently sign with the wrong trust domain's CA, which is the exact failure this milestone exists to prevent.

Archived-zone semantics (amendment A3): status='archived' blocks NEW CAs, hosts, identities, principals and certificate issuance in that zone, and hides it from pickers. It does NOT stop serving existing material -- trust downloads, KRL generation and ECIES pulls keep working -- so archiving never silently locks an operator out of hosts that are still running. Hard deletion stays impossible while rows reference the zone (ON DELETE RESTRICT, enforced by TASK-218).

`zone_id` is immutable through the API: moving a host or identity between zones invalidates its certificates (signed by the old zone's CA) and is an offboard + re-enroll operation, not an update.

Service shape follows the existing SSH services (ssh-ca.service.ts): a class, a `get<Name>Service()` singleton, typed errors mapped at the edge, and an audit_log row for every state change (repo convention: every state-changing operation writes audit, success and failure).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An operator can create, list, rename the display name of, archive and un-archive a zone
- [x] #2 On an installation with a single zone, every existing call that does not mention a zone keeps working exactly as before
- [x] #3 Once a second zone exists, a call that does not name a zone fails with an error that names the available zones instead of silently picking one
- [x] #4 A zone can be addressed by its slug as well as by its id
- [ ] #5 Creating a CA, host, identity, principal or certificate in an archived zone is refused, while trust material already in that zone is still served
- [ ] #6 Every zone create, update and archive writes an audit_log row
<!-- AC:END -->









## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New backend/src/services/ssh-zone.service.ts (or zone.service.ts -- it is generic per decision-017; prefer zone.service.ts since X.509 may adopt it):
   - ZoneDto { id, name, displayName, description, status, createdAt, counts? }
   - create({ name, displayName, description }) -- slug validated ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$, unique name -> ZoneExistsError
   - list({ includeArchived? }), get(idOrSlug), update({ displayName, description }) (never name/status via update)
   - archive(id) / unarchive(id) -- audit 'ssh.zone.archive'
   - resolveZone(ctx, explicit?) as specified above
   - assertWritable(zone) -- throws ZoneArchivedError for creation/issuance paths
2. Typed errors: SshZoneNotFoundError, SshZoneAmbiguousError, SshZoneArchivedError, SshZoneExistsError. Wire them into the tRPC mapper in trpc/procedures/ssh.ts (mapSshError) -> NOT_FOUND / BAD_REQUEST / CONFLICT, and rely on the REST error handler's /not found/i -> 404 rule.
3. Audit operations: ssh.zone.create / ssh.zone.update / ssh.zone.archive, entityType 'zone'.
4. Unit tests (new file, no KMS needed): single-zone implicit resolution returns the seeded default; after creating a second zone an omitted zone throws SshZoneAmbiguousError and the message names both slugs; an archived-only install still resolves implicitly (archived zones are excluded from the "exactly one" count -- decide and TEST the edge where the only zone is archived: it must still resolve, otherwise an install can brick itself); resolution by slug and by id both work; slug validation rejects uppercase/underscore/leading dash.
5. pnpm typecheck + backend suite.
<!-- SECTION:PLAN:END -->
