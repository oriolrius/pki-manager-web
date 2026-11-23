---
id: TASK-246
title: 'SSH principals: Stale means principal files changed and not pushed'
status: To Do
assignee: []
created_date: '2026-11-23T18:57:00Z'
labels:
  - ssh
  - backend
dependencies: []
ordinal: 73014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today a host is Stale when host.updatedAt > lastPrincipalPushAt. Host certificate issue/renew also sets updatedAt, so every renewal flags the host Stale without any mapping change, and nothing in automation ever clears it. Track a dedicated change time that moves only when the host's rendered principal files change, and let fleet automation acknowledge a push with a hash of the exact files it installed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Issuing or renewing a host certificate does not make the host Stale
- [ ] #2 Adding or removing a principal mapping on a host makes that host (and only that host) Stale until it is marked pushed
- [ ] #3 After the migration, hosts that were already pushed (or have no mappings) are not Stale; hosts with mappings that were never pushed are Stale
- [ ] #4 The fleet-token GET auth-principals response includes a sha256 of the rendered files in a documented canonical form
- [ ] #5 A fleet token with get-principals can POST the sha256 to acknowledge a push: a matching hash clears Stale, a different hash returns 409 with the current hash and changes nothing
- [ ] #6 Every acknowledgement attempt writes an audit_log row; docs/ssh-api-contract.md documents the endpoint and the canonical form
<!-- AC:END -->
