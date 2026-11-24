---
id: TASK-263
title: Do not return stack traces in tRPC error responses in production
status: To Do
assignee: []
created_date: '2026-11-24T10:18:00Z'
labels:
  - security
  - bug
dependencies: []
priority: high
ordinal: 83014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the published 3.15.0 image, a tRPC 401 response body contains the server stack trace (seen on the docs demo stack, 2026-11-24). Production responses must not leak internals.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With NODE_ENV=production, tRPC error responses contain no stack trace
- [ ] #2 A test covers an unauthenticated tRPC call in production mode
<!-- AC:END -->
