---
id: TASK-239
title: Audit rate limiter sees real client IPs behind the reverse proxy
status: To Do
assignee: []
created_date: '2026-10-23 14:06'
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
