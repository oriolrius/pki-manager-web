---
id: TASK-245
title: 'SSH principals: remove a host mapping and an identity grant'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-23T18:57:00Z'
updated_date: '2026-11-23T19:04:00Z'
labels:
  - ssh
  - backend
  - frontend
dependencies: []
ordinal: 72014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Operators can map a principal to a host account and grant a principal to an identity, but nothing can undo either: there is no unmap and no ungrant, and deletePrincipal is refused while maps or grants reference the principal. The only way to remove a mapping today is to offboard the whole host. Grants have no UI at all. Add unmap and revoke-grant (service + tRPC + REST + audit) and the UI to use them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can remove one principal->local account mapping from a host (tRPC and REST), and the host then shows Stale until the updated files are pushed
- [ ] #2 An operator can revoke one grant (identity may encode principal) via tRPC and REST
- [ ] #3 Removing a mapping or grant that does not exist fails with a not-found error instead of a silent success
- [ ] #4 Each unmap and revoke-grant writes an audit_log row on success and on failure
- [ ] #5 The host mapping card has a remove action per mapping row with a confirm that explains the server keeps accepting the principal until the updated files are deployed
- [ ] #6 The identity on the Users page has an Allowed principals section that lists, adds and removes grants and explains that grants are enforced with the entitlement check and feed the host Access list
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Service: unmapFromHost(hostId, principalId, localAccount) deletes the one map row, marks the host principals changed, audits; revokeGrant(identityId, principalId); listGrants(identityId). Unknown rows -> not-found error + failure audit.
2. Zod schemas + tRPC principal.unmap / revokeGrant / listGrants; REST POST /principals/unmap, POST /principals/revoke-grant, GET /identities/:id/grants.
3. UI: remove (x) per mapping row in HostPrincipalMappingCard with confirm; Allowed principals section in the identity card (list/add/remove).
4. Tests: backend service + REST; frontend RTL for both UIs.
<!-- SECTION:PLAN:END -->
