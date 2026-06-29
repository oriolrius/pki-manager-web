---
id: TASK-130
title: >-
  SSH-12: ssh-host.service.ts: issue/list/get/revoke host certificates + sshd
  drop-in
status: Done
assignee: []
created_date: '2026-06-29 15:41'
updated_date: '2026-06-29 18:03'
labels:
  - ssh-cert-manager
  - backend
  - services
milestone: SSH Certificate Manager
dependencies:
  - TASK-129
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Singleton service that registers a host (pasted Ed25519/ECDSA pubkey) and issues a Host-CA-signed cert via signCertificate: principals = FQDN + all IPs, type=host, validity default +52w, key-id = '<fqdn>-<date>-<serial>'. Persists ssh_certificates (host) + updates the host's current_cert_id/status. get() returns the cert plus a ready-to-paste sshd_config drop-in (HostKey/HostCertificate/TrustedUserCAKeys/AuthorizedPrincipalsFile). Listable/filterable by host_id, principal, serial, key-id, expiry. revoke() marks the cert revoked (by key fingerprint and/or explicit serial) and makes it eligible for the next KRL build. Re-issue/renew via SSH-11 renewal semantics without re-registering the pubkey.

**Epic:** SSH CA & Signing Services
**Logical deps:** SSH-11
**Touchpoints:** backend/src/services/ssh-host.service.ts, backend/src/services/ssh-host.service.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An operator can submit a host public key and receive a signed host cert whose principals contain the FQDN and every supplied IP; the API never accepts a private key
- [x] #2 get() returns a ready-to-paste sshd_config drop-in and the cert in OpenSSH format
- [x] #3 Issued host certs are listable/filterable by host_id, principal, serial, key-id, and expiry
- [x] #4 revoke() marks the cert revoked (by key fingerprint/explicit serial), triggers KRL regeneration for its CA, and renew re-signs without re-registration
<!-- AC:END -->
