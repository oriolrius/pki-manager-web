---
id: TASK-143
title: >-
  SSH-MON: Rate limiting + abuse controls + health/metrics for expiring certs,
  stale KRLs, non-pulling hosts
status: In Progress
assignee:
  - '@myself'
created_date: '2026-06-29 15:44'
updated_date: '2026-06-29 18:32'
labels:
  - ssh-cert-manager
  - backend
  - revocation
milestone: SSH Certificate Manager
dependencies:
  - TASK-138
  - TASK-142
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two related ops concerns the brief named (monitoring) and the security lens raised (abuse). ABUSE CONTROLS: rate-limit the public /krl/:caId.* endpoints per client (fleet-wide pull bursts) and the external /sign-host|/sign-user|/register-host-pubkey per token, returning a stable 404 for unknown CA IDs without leaking 'no CA' vs 'no KRL'; document the ECIES 404-vs-200 host_id oracle as an accepted, bounded disclosure. MONITORING: a metrics/health query or endpoint exposing counts of SSH certs expiring within the TTL window, KRLs past next_update, and hosts whose last_krl_fetch_at is older than 2x the pull interval — machine-readable for an alerting hook, not only a dashboard tile. With +1w user TTLs and pull-based KRL, a missed renewal or a host that stopped pulling must be detectable without opening the UI.

**Epic:** SSH Revocation & KRL
**Logical deps:** SSH-19, SSH-22
**Touchpoints:** backend/src/server.ts, backend/src/rest/routes/ssh.routes.ts, backend/src/services/ssh-krl.service.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Public /krl/:caId.* endpoints are rate-limited per client and return a stable 404 for unknown CA IDs that does not distinguish 'no CA' from 'no KRL' to aid enumeration
- [ ] #2 External /sign-host, /sign-user, /register-host-pubkey are rate-limited per token and reject bursts beyond a configured threshold
- [ ] #3 A query/endpoint exposes counts of SSH certs expiring within the TTL window, KRLs past next_update, and hosts whose last KRL fetch is older than 2x the pull interval, in a machine-readable form for alerting
- [ ] #4 The ECIES 404-vs-200 host_id disclosure (if/when that path ships) is documented as accepted and bounded (registered-or-not only)
<!-- AC:END -->
