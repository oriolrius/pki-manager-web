---
id: TASK-109.07
title: 'Frontend: Clusters management page'
status: Done
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 16:58'
labels:
  - frontend
  - ui
dependencies:
  - TASK-109.04
parent_task_id: TASK-109
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
/clusters route: list, register (with CA selector), copy-once token modal, revoke action.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /clusters route added in TanStack Router
- [ ] #2 Token shown once with copy-to-clipboard and warning
- [ ] #3 List shows name, CA, last_seen, status badge
- [ ] #4 Revoke confirmation modal calls trpc.cluster.revoke
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
/clusters route + nav link + register modal + copy-once token + revoke.
<!-- SECTION:NOTES:END -->
