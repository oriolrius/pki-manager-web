---
id: task-071
title: Convert Zod schemas to JSON Schema for OpenAPI
status: To Do
assignee: []
created_date: '2025-11-27 15:35'
updated_date: '2025-11-27 16:31'
labels:
  - openapi
  - backend
  - schemas
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create JSON Schema versions of existing Zod validation schemas for use in OpenAPI documentation.

Use zod-to-json-schema library to convert schemas while maintaining validation consistency.

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zod-to-json-schema package installed
- [ ] #2 backend/src/rest/schemas/openapi-schemas.ts created
- [ ] #3 All request/response schemas converted to JSON Schema
- [ ] #4 Schema references properly linked in OpenAPI spec

- [ ] #5 All existing tests pass after schema conversion
- [ ] #6 Test results captured in implementation notes showing all tests pass
<!-- AC:END -->
