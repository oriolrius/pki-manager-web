---
id: TASK-150
title: >-
  SSH-29: Principals/RBAC catalog UI + Revocation/KRL UI with telemetry-sourced
  distribution status
status: To Do
assignee: []
created_date: '2026-06-29 15:45'
labels:
  - ssh-cert-manager
  - frontend
milestone: SSH Certificate Manager
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two pages. Principals: the source-of-truth catalog of role-principals and their principal→account mapping per host/host-group; RENDERS the /etc/ssh/auth_principals/<account> files and the AuthorizedPrincipalsFile directive (copyable/downloadable per account and as a bundle), shows which hosts/groups receive which mappings, and FLAGS hosts whose catalog mappings are stale vs last push (SSH-14 drift). Revocation/KRL: revoke a cert/key/explicit-serial with a reason; current KRL view per CA (version sha256, revoked count, last-updated, next-update, KRL age, list of revoked serials/keys with key-ids); a per-host distribution status table sourced from REAL telemetry (ssh_hosts.last_krl_version/last_krl_fetch_at from SSH-06/SSH-22 callback), showing up-to-date/stale/unknown badges; and for each revoked identity its cert expiry so the operator can judge whether KRL propagation is still needed. Both reuse ConfigSnippet/DeployPanel and trpc.ssh.*.

**Epic:** SSH Operator Console (Frontend)
**Logical deps:** SSH-25, SSH-17, SSH-21, SSH-27, SSH-28
**Touchpoints:** frontend/src/routes/ssh.principals.tsx, frontend/src/routes/ssh.principals.new.tsx, frontend/src/routes/ssh.krl.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can define role-principals, map them to local accounts, generate the exact /etc/ssh/auth_principals/<account> file contents (copyable/downloadable per account and as a bundle) plus the AuthorizedPrincipalsFile directive, and see per-host which mappings apply and which hosts are stale vs last push
- [ ] #2 An operator can revoke an SSH cert or paste a key/explicit-serial to revoke, choose a reason, and immediately see the KRL version increment and the directive appear in the auditable revocation list (scope/value/reason/who/when)
- [ ] #3 The KRL panel shows version, revoked count, last-updated, next-update and KRL age per CA and offers signed-envelope + bare-KRL downloads; the per-host distribution table shows each host's last-fetched version and last-seen from real telemetry, with up-to-date/stale/unknown indicators
- [ ] #4 Revocation is reachable from this page and from host/user detail pages and converges on the same KRL state; each revoked identity shows its cert expiry
<!-- AC:END -->
