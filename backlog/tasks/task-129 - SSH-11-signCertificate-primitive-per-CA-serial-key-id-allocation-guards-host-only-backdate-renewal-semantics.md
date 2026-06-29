---
id: TASK-129
title: >-
  SSH-11: signCertificate primitive: per-CA serial/key-id allocation, guards,
  host-only backdate, renewal semantics
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
  - TASK-118
  - TASK-119
  - TASK-120
  - TASK-127
  - TASK-124
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose signCertificate(ctx, { caId, sshPublicKey, type:'user'|'host', keyId, principals[], serial?, validAfter, validBefore, criticalOptions, extensions[] }) → { certOpenssh, fingerprint, serial, validBefore } wiring the parser (SSH-02), encoder (SSH-01) and signRaw signer (SSH-03). Validates type matches CA caType (mixing is a hard sshd error), rejects empty principals unless explicitly wildcarded (SSH-01 guard), validates key_id grammar, and allocates a per-CA monotonic serial transactionally from ssh_cas.next_serial via optimistic UPDATE...WHERE next_serial=serial retry-on-zero-rows (correct on better-sqlite3's single writer; gaps allowed, duplicates never). BACKDATE: applies a small notBefore backdate to HOST certs by default (the PoC backdates only host certs: -V '-5m:+52w'); user certs are NOT auto-backdated (the PoC uses -V '+1w'), and the UI instead surfaces NTP guidance for short user TTLs. RENEWAL: a renewal allocates a NEW serial and key_id, sets the prior cert's superseded_by, and (configurable) revokes the superseded serial into the KRL where overlap is unwanted, preserving the stable host_id/identity_id link so audit correlation survives the key_id change. Optional CA-level max-TTL cap. This is the single primitive host/user services call.

**Epic:** SSH CA & Signing Services
**Logical deps:** SSH-01, SSH-02, SSH-03, SSH-10, SSH-07
**Touchpoints:** backend/src/services/ssh-cert.service.ts, backend/src/services/ssh-cert.service.test.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A host caller gets a signed host cert (type 2) with principals = supplied FQDN+IPs; a user caller gets a user cert (type 1) with principals = role names — both pass ssh-keygen -L; requesting a user cert from the Host CA (or vice versa) is rejected before any KMS call
- [x] #2 Serials are unique and monotonic per CA under concurrent issuance (UI + automation use the same scheme); an empty-principal or malformed-key_id request is rejected before signing; a TTL exceeding the CA cap is rejected
- [x] #3 Freshly issued HOST certs are accepted by an sshd whose clock is slightly ahead (host-only notBefore backdate applied); user certs are not auto-backdated and the returned object includes serial and validBefore
- [x] #4 Renewal allocates a new serial+key_id, links via superseded_by, optionally revokes the prior serial into the KRL, and preserves the host_id/identity_id audit link — covered by a test asserting whether renewing invalidates the prior cert
<!-- AC:END -->
