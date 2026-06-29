---
id: TASK-131
title: >-
  SSH-13: ssh-user.service.ts: issue/list/get/revoke user certs with extensions
  + validated critical options
status: To Do
assignee: []
created_date: '2026-06-29 15:41'
labels:
  - ssh-cert-manager
  - backend
  - services
milestone: SSH Certificate Manager
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Singleton service that signs a user's pubkey with the User CA: principals = role names, type=user, validity default +1w (short TTL = primary revocation), key-id = the named identity (audit anchor). Supports least-privilege whitelisting (ssh-keygen -O clear semantics): explicit extensions list (permit-pty, permit-agent-forwarding, permit-port-forwarding, permit-X11-forwarding, permit-user-rc) and critical options force-command / source-address. INPUT VALIDATION: source-address must parse as one or more valid CIDRs (v4/v6) and a malformed CIDR is rejected at issuance (not silently encoded into a wrong restriction); force-command is taken verbatim and the live preview shows exactly what will be enforced. Optionally constrains chosen principals to the identity's ssh_user_principals entitlement. Persists ssh_certificates (user). NOTE the PoC does NOT backdate user certs; rely on NTP + the operator-TZ/UTC display, not a backdate, for short user TTLs.

**Epic:** SSH CA & Signing Services
**Logical deps:** SSH-11
**Touchpoints:** backend/src/services/ssh-user.service.ts, backend/src/services/ssh-user.service.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can issue a user cert carrying chosen role principals and an explicit extension whitelist; a hardened cert (no permit-pty) behaves as least-privilege per ssh-keygen -L
- [ ] #2 force-command and source-address critical options are settable and appear in ssh-keygen -L; a malformed source-address CIDR is rejected at issuance rather than silently encoded
- [ ] #3 Key-id is a free-form (control-char-validated) human identifier persisted for audit correlation; default validity is short (+1w, configurable) and surfaced as the primary revocation mechanism with no auto-backdate
- [ ] #4 Revoking a user cert triggers KRL regeneration; get()/list() expose principals, extensions, critical options, serial, key-id, expiry
<!-- AC:END -->
