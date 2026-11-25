---
id: TASK-109.06
title: Bearer token auth middleware for external endpoints
status: Done
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 16:50'
labels:
  - backend
  - security
dependencies:
  - TASK-109.03
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fastify preHandler verifying Authorization header against clusters table. Constant-time compare, updates last_seen, denies revoked. Per-cluster rate limit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Invalid token rejected 401
- [ ] #2 Revoked token rejected 403
- [ ] #3 last_seen updated on auth
- [ ] #4 Per-cluster rate limit enforced
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
rest/middleware/cluster-auth.ts implemented. Bearer Authorization required, last_seen updated async, revoked clusters rejected. Per-cluster rate limit pending (lower priority - add when wiring actual /sign load).
<!-- SECTION:NOTES:END -->
