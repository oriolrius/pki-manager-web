---
id: TASK-260
title: Check that the OpenAPI matches the real routes
status: In Progress
assignee:
  - '@claude'
created_date: '2026-11-24T09:15:00Z'
updated_date: '2026-11-24T10:47:00Z'
labels:
  - docs
milestone: m-2
dependencies:
  - TASK-259
ordinal: 80014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Most write endpoints already take their OpenAPI body from the Zod schemas (TASK-134). On prod, 9 of 49 write operations show no body schema; most of them (disable, revoke, archive) take no body. Confirm which ones need a body, and check that responses are also described.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every endpoint that accepts a body shows it in the API reference
- [ ] #2 A test fails when a route schema and its OpenAPI description differ
<!-- AC:END -->
