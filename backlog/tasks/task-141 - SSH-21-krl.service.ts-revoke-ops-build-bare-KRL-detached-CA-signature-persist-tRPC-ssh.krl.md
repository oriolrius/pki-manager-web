---
id: TASK-141
title: >-
  SSH-21: krl.service.ts: revoke ops + build bare KRL + detached CA signature +
  persist + tRPC ssh.krl
status: To Do
assignee: []
created_date: '2026-06-29 15:43'
updated_date: '2026-06-29 15:47'
labels:
  - ssh-cert-manager
  - backend
  - revocation
milestone: SSH Certificate Manager
dependencies:
  - TASK-140
  - TASK-120
  - TASK-121
  - TASK-126
  - TASK-127
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add ssh-krl.service.ts as a near-clone of crl.service.ts (singleton, (ctx,params), validate→KMS→persist→audit→DTO). Expose revokeByCert/Serial/Key/listRevocations writing ssh_revocations rows, and generate(ctx,{caId}) that loads directives, builds the BARE unsigned KRL bytes via crypto/ssh/krl.ts (stored as ssh_krls.krl_blob — what sshd reads), separately computes a DETACHED CA signature over those bytes via kmsService.signRaw using the format pinned in SSH-04 (stored as ssh_krls.ca_signature — verified ONLY by the puller, never by sshd), computes version_hash, and persists {krl_blob, ca_signature, version, monotonic krl_number, this/next-update}. Add procedures/ssh-krl.ts composed into the ssh router. Revoking a catalogued cert also flips ssh_certificates.status.

**Epic:** SSH Revocation & KRL
**Logical deps:** SSH-20, SSH-03, SSH-04, SSH-09, SSH-10
**Touchpoints:** backend/src/services/ssh-krl.service.ts, backend/src/trpc/procedures/ssh-krl.ts, backend/src/trpc/router.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An operator can revoke an issued SSH cert by explicit serial, a pasted pubkey by its SHA256 hash, and (for a catalogued cert) by key fingerprint — each writing an ssh_revocations row and an audit_log entry with reason and actor
- [ ] #2 generate() persists the BARE unsigned KRL (krl_blob) AND a distinct detached CA signature (ca_signature, in the SSH-04-pinned format) that verifies against the SSH CA public key; the persisted KRL records version (sha256) and a monotonically increasing krl_number
- [ ] #3 tRPC ssh.krl.{generate,get,listRevocations,revoke*} let the frontend revoke and immediately fetch the regenerated KRL version with full type inference
- [ ] #4 Revoking a catalogued ssh_certificate flips its status to revoked; the detached signature is documented as puller-only and is NOT embedded in krl_blob
<!-- AC:END -->
