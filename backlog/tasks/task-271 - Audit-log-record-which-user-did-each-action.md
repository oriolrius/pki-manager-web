---
id: TASK-271
title: 'Audit log: record which user did each action'
status: To Do
assignee: []
created_date: '2026-11-24T10:34:00Z'
labels:
  - security
  - audit
dependencies: []
ordinal: 91014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Audit rows carry operation, entity, IP, time, status and details, but no user identity (found by the docs MQTT guide, 2026-11-24). "Who did what" needs the OIDC subject/username, or the integration id for tokens.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every audit row of an authenticated action names the user or the integration
<!-- AC:END -->
