---
id: TASK-239
title: Audit rate limiter sees real client IPs behind the reverse proxy
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-23 14:06'
updated_date: '2026-10-26 15:50'
labels:
  - backend
  - security
  - audit
dependencies: []
ordinal: 66014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Since v3.15.0 anonymous external.reject audit rows are rate-bounded per IP, but the backend does not set Fastify trustProxy, so behind the prod reverse proxy every request has the proxy IP: one anonymous row per minute for the whole internet, and rows lack the real client IP. Drops are silent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Behind the production reverse proxy, external.reject rows record the real client IP
- [x] #2 A spoofed X-Forwarded-For from an untrusted source does not change the recorded IP
- [x] #3 Dropped anonymous rejection rows are counted and logged once per window
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify: trustProxy unset; prod NPM (and the frontend nginx) send X-Forwarded-For; req.ip feeds every audit_log row and the KRL rate limit, not only the rejection budget
2. Add TRUST_PROXY (unset = off, the current behaviour): a comma-separated list of proxy IPs/CIDRs (recommended) or a hop count; invalid values fail at startup
3. RejectionAuditBudget: count dropped rows and log one summary per closed window (also via an unref'd timer, so the last window is not lost)
4. Tests: parser, req.ip with trusted vs untrusted peers (spoofed XFF ignored), external.reject ipAddress, drop summary
5. Real check: nginx container in front of an isolated backend; compare audit rows via the proxy vs direct with a forged XFF
6. Docs: backend/.env.example, docker compose passthrough, DEPLOYMENT.md (prod value for k5)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code done in f2c7a85; **prod rollout pending** (AC #1).

**Verified before starting:** `trustProxy` was never set, while the prod edge proxy (k5 NPM, `nginx-locations.conf`) and `docker/nginx.conf` already send `X-Forwarded-For`. Wider impact than the audit budget: `req.ip` feeds every `audit_log.ip_address` (100 call sites) and the KRL rate limit (`krl:${req.ip}`, 120/min), which behind the proxy every host shared as one client. No code reads `req.protocol`/`req.hostname`, so enabling trustProxy changes only `req.ip`.

**Changes**
- `backend/src/lib/trust-proxy.ts`: `TRUST_PROXY` → Fastify `trustProxy`. IPs/CIDRs (or `loopback`/`linklocal`/`uniquelocal`), or a hop count 1..10; unset = previous behaviour; `true` and malformed entries fail at startup.
- `RejectionAuditBudget`: counts dropped rows; one `logger.warn` per window with drops (`windowStart`, `dropped`), closed by `allow()` or an unref'd 60 s timer (cleared `onClose`).
- Docs: DEPLOYMENT.md section "Client IPs behind a reverse proxy", `backend/.env.example`, `docker/.env.example`, the Compose passthrough, `backend/AGENTS.md`.

**Verification**
- Unit/route tests: parser, `req.ip` trusted vs untrusted peer, forged chain, `external.reject` `ipAddress` behind a trusted proxy, drop summary (incl. the timer path). Backend 806 tests, typecheck and build pass.
- Real nginx (`--network host`) in front of an isolated backend (`TRUST_PROXY=127.0.0.1`, temp DB): a client at 172.26.115.195 via nginx with forged XFF 203.0.113.60 → row `172.26.115.195`; a direct client with a forged header → its TCP peer; 5 dropped rejections → one `WARN … dropped: 5, windowStart 15:46:00Z` when the minute closed; `TRUST_PROXY=true` → startup error.
- Test-setup gotcha: if the curl client is itself a trusted address (loopback), proxy-addr keeps walking to the forged entry. Expected: real clients are never in the trusted list.

**Pending for AC #1 (prod, needs Oriol):** deploy a release with this commit to k5, and set `TRUST_PROXY` on `pki-backend` in `k5-stack-pki` to the networks NPM and `pki-frontend` connect from (`pki_net` 10.222.35.0/24 plus the `services` network CIDR; check with `docker network inspect services`). Then check that a tokenless `GET /api/v1/external/health` produces an `external.reject` row with the public IP.
<!-- SECTION:NOTES:END -->
