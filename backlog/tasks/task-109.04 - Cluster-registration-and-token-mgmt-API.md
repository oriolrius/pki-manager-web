---
id: TASK-109.04
title: Cluster registration and token mgmt API
status: To Do
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 16:21'
labels:
  - backend
  - api
dependencies:
  - TASK-109.03
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tRPC procedures register/list/revoke clusters; one-time API tokens scoped to a CA. Tokens hashed (argon2). Revoke invalidates immediately.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 trpc.cluster.register mutation returns token shown once
- [ ] #2 trpc.cluster.list returns clusters with last_seen and status
- [ ] #3 trpc.cluster.revoke soft-deletes cluster
- [ ] #4 Tokens hashed at rest, never returned again
<!-- AC:END -->
