---
id: TASK-149
title: >-
  SSH-28: SSH Users: issue cert with capability editor + live decoded preview +
  detail
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
User/identity pages. List shows identity (key-id/name), principals (roles), TTL/expiry, serial, status. Issue flow centers on a friendly SshCapabilityEditor: principals (roles) tag-input, 5 permit-* extension toggles (default-on) with a 'Harden — clear all' preset (mirrors ssh-keygen -O clear), force-command and source-address (validated CIDR) inputs, a Key ID field prefilled with an audit-anchor template, a TtlPicker (presets +1h/+1d/+1w + custom, default +1w), optional serial, and a paste-the-user-pubkey input. A live 'ssh-keygen -L preview' (driven by the backend decoded-cert DTO) reflects choices to prevent foot-guns. An NTP note accompanies short TTLs (user certs are not backdated). Detail shows the decoded cert, a ~/.ssh/config + ssh-add snippet via ConfigSnippet, cert download, and renew (pre-fills the editor)/revoke.

**Epic:** SSH Operator Console (Frontend)
**Logical deps:** SSH-25, SSH-26, SSH-17
**Touchpoints:** frontend/src/routes/ssh.users.tsx, frontend/src/routes/ssh.users.new.tsx, frontend/src/routes/ssh.users.$id.tsx, frontend/src/components/SshCapabilityEditor.tsx, frontend/src/components/TtlPicker.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can issue a User-CA-signed cert by pasting a user pubkey, choosing principals/roles, toggling extensions, optionally setting force-command and a validated source-address CIDR, and picking a TTL
- [ ] #2 The 'Harden' preset clears all default extensions (matching ssh-keygen -O clear) and the live preview reflects which extensions/critical-options are present before issuing; a malformed source-address CIDR is rejected in the form
- [ ] #3 After issuance the operator can download the user cert and copy a ready-to-paste ~/.ssh/config block (IdentityFile/CertificateFile/IdentitiesOnly) and the ssh-add hint
- [ ] #4 The detail page shows the full decoded cert, TTL/expiry with shared days-left coloring + a short-TTL NTP note and a renewal nudge; renew re-opens the editor pre-filled; no private key is ever sent to the backend
<!-- AC:END -->
