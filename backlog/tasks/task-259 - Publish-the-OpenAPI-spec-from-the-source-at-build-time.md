---
id: TASK-259
title: Publish the OpenAPI spec from the source at build time
status: To Do
assignee: []
created_date: '2026-11-24T09:15:00Z'
labels:
  - docs
milestone: m-2
dependencies:
  - TASK-251
priority: high
ordinal: 79014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The site build generates the OpenAPI document from the backend code (not from prod) and renders it as an API reference page with search.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 API reference lists all REST endpoints of the current version
- [ ] #2 The spec is generated in CI without a running prod instance
<!-- AC:END -->
