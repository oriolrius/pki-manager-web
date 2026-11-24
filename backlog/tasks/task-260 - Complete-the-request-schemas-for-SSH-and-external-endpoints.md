---
id: TASK-260
title: Complete the request schemas for SSH and external endpoints
status: To Do
assignee: []
created_date: '2026-11-24T09:15:00Z'
labels:
  - docs
milestone: m-2
dependencies:
  - TASK-259
ordinal: 80014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Today the OpenAPI under-specifies SSH and external issuer bodies (the real shape lives only in the backend Zod schemas). Generate the OpenAPI bodies from those Zod schemas.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every SSH and external endpoint shows its full request and response body
- [ ] #2 A test fails when a route schema and its OpenAPI body differ
<!-- AC:END -->
