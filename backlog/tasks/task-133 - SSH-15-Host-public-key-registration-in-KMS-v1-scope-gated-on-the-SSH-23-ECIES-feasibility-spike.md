---
id: TASK-133
title: >-
  SSH-15: Host public-key registration in KMS (v1 scope, gated on the SSH-23
  ECIES feasibility spike)
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
v1 scope, GATED on the SSH-23 feasibility spike proving Cosmian supports external-pubkey Register + locate-by-tag + ec encrypt/decrypt for nistp256. If SSH-23 disproves feasibility, SSH-15 (and SSH-24) are dropped and revocation falls back to the bare served KRL (SSH-22). At host-cert issuance, if the ECIES path is enabled, register the host's public key in KMS tagged by host_id (+ a host-pubkey tag) and store the resulting kms_pubkey_id on ssh_hosts so the per-host KRL sidecar can locate-by-tag and ECIES-encrypt to it. This requires the KMS client to REGISTER an externally-supplied EC public key as a KMS object — genuinely new client work, verified by SSH-23's spike, not assumed. Registration is bound to a VERIFIED source: the registered pubkey must fingerprint-match the pubkey just signed in the host cert (preventing a malicious/buggy registration binding the wrong key and silently breaking emergency revocation). host_id is validated against a strict hostname grammar before use as a tag. Cert issuance never depends on registration succeeding: on failure the host gets a 'KRL-undeliverable' status and kms_pubkey_id stays null.

**Epic:** SSH CA & Signing Services
**Logical deps:** SSH-12, SSH-23
**Touchpoints:** backend/src/services/ssh-host.service.ts, backend/src/kms/service.ts, backend/src/kms/client.ts, backend/src/db/schema.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When the ECIES path is disabled, issuance proceeds with no KMS registration call and no dependency on KMS Locate/Register; when enabled and the spike has proven external-pubkey Register works, issuing a host cert registers that host's pubkey in KMS tagged with host_id + host-pubkey, fingerprint-matched to the just-signed cert, storing kms_pubkey_id
- [ ] #2 A locate-by-tag for a registered host_id resolves exactly one pubkey id and zero for an unregistered host
- [ ] #3 An operator can rotate/re-register a host's distribution pubkey without re-issuing its cert, old registrations are superseded, and a registration mismatch surfaces as host 'KRL-undeliverable' status rather than a silent failure
- [ ] #4 host_id is validated against a strict hostname grammar before being used as a KMS tag; registration failure does not block cert issuance (kms_pubkey_id stays null)
<!-- AC:END -->
