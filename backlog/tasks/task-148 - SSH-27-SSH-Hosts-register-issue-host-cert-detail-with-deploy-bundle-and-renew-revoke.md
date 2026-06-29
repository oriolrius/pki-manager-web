---
id: TASK-148
title: >-
  SSH-27: SSH Hosts: register/issue host cert + detail with deploy bundle and
  renew/revoke
status: To Do
assignee: []
created_date: '2026-06-29 15:44'
labels:
  - ssh-cert-manager
  - frontend
milestone: SSH Certificate Manager
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Host management pages. List shows fqdn, principals, serial, key-id, expiry (shared days-left coloring), and KRL/registration status. Register/issue flow accepts the host's pasted Ed25519/ECDSA pubkey, auto-suggests principals (FQDN + IP tag-input reusing the SAN-array pattern), serial, key-id, validity (default +52w), prevents submitting a private key, and warns host keys must be generated on the node. Detail renders the full deploy bundle via DeployPanel (host cert file, sshd_config.d/10-ssh-ca.conf drop-in, install one-liner), a ssh-keygen -L style decoded-cert panel, KMS registration status for KRL with a (re)register action (only shown when the ECIES path is enabled), renew/revoke, and a one-click zip bundle (cert + drop-in + README).

**Epic:** SSH Operator Console (Frontend)
**Logical deps:** SSH-25, SSH-26, SSH-17
**Touchpoints:** frontend/src/routes/ssh.hosts.tsx, frontend/src/routes/ssh.hosts.new.tsx, frontend/src/routes/ssh.hosts.$id.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can register a host by pasting its public host key and issue a Host-CA-signed cert whose principals include the FQDN and all IPs; the form blocks private keys
- [ ] #2 After issuance the operator can view the decoded cert (type, principals, serial, key-id, valid_after/before in operator-TZ and UTC) and download the cert plus a ready-to-paste sshd_config drop-in and a zip bundle in one click
- [ ] #3 The host list shows each cert's expiry with the shared color-coded days-left treatment; KRL registration status/action appears only when the ECIES path is enabled; re-issue/renew works without re-registering
- [ ] #4 An operator can renew (re-sign) or revoke from the detail page, and revocation routes the key into the KRL flow
<!-- AC:END -->
