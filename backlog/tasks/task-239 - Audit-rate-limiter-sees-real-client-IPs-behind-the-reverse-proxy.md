---
id: TASK-239
title: Audit rate limiter sees real client IPs behind the reverse proxy
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-23 14:06'
updated_date: '2026-10-26 15:44'
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
- [ ] #2 A spoofed X-Forwarded-For from an untrusted source does not change the recorded IP
- [ ] #3 Dropped anonymous rejection rows are counted and logged once per window
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
