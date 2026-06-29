---
id: TASK-142
title: >-
  SSH-22: Public bare-KRL serving endpoint + NEW
  ETag/304/lazy-regen/last-good-fallback + auto-regen on revocation
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
  - TASK-141
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Serve the BARE unsigned KRL for RevokedKeys/RevokedHostKeys at a public GET /krl/:caId.bin (application/octet-stream), registered like the existing public /crl route (bare server.get in server.ts, added to the public-path allowlist) — this task OWNS the public raw-bytes route (SSH-18 does not). The bytes are what sshd reads; trust on the public path rests on TLS + 0444 root-owned file perms, documented honestly (sshd does NOT verify any KRL signature — technical-reference §7.1). A SEPARATE authenticated endpoint returns {krl_b64, ca_signature_b64, krl_version, signed_at} for the (deferred) sidecar/puller. CRITICALLY, the ETag/X-KRL-Version, If-None-Match/304, Last-Modified/Expires/Cache-Control-from-next_update, lazy-regeneration-when-stale, and last-good-signed-bytes fallback are ALL NEW work — the real /crl route (server.ts:127-206) has none of them and 503s when empty — so they are explicit scope here, not a 'mirror'. Every revocation path triggers regeneration so a directive lands immediately.

**Epic:** SSH Revocation & KRL
**Logical deps:** SSH-21
**Touchpoints:** backend/src/server.ts, backend/src/services/ssh-krl.service.ts, backend/src/rest/middleware/auth.ts
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A host can GET /krl/:caId.bin over plain HTTP and install the bytes as RevokedKeys so sshd revokes the listed keys without restart; the trust model (TLS + file perms, sshd does not verify the KRL signature) is documented in the response/route comments and operator docs
- [ ] #2 A matching If-None-Match yields 304 with no body (NEW behaviour, not present on /crl); responses set ETag/X-KRL-Version and Last-Modified/Expires/Cache-Control from next_update; an unknown caId returns a stable 404
- [ ] #3 Revoking a key/serial via any path causes the next GET to return a higher version revoking it (verified with ssh-keygen -Q); a stale KRL is lazily regenerated before serving, falling back to last-good bytes if signing is unavailable (never an empty/503 KRL once one exists)
- [ ] #4 The raw .bin endpoint requires no authentication, is safe behind a CDN, and an emergency revocation is reflected without restarting the backend; this task is the sole owner of the public raw-bytes route
<!-- AC:END -->
