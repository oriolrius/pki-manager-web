---
id: task-078
title: Add OpenAPI Documentation Page with Navigation
status: To Do
assignee: []
created_date: '2025-11-28 09:40'
labels:
  - frontend
  - openapi
  - documentation
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a new frontend route that renders interactive OpenAPI documentation using Swagger UI. The backend already exposes OpenAPI JSON at /api/docs/json and has Swagger UI at /api/docs. This task adds a dedicated page in the frontend with a navigation menu entry for easy access to the API documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New route /api-docs renders OpenAPI documentation in the frontend
- [ ] #2 Navigation menu includes 'API Docs' link with appropriate icon
- [ ] #3 Page fetches and displays OpenAPI spec from backend /api/docs/json
- [ ] #4 Swagger UI component renders interactive API documentation
- [ ] #5 Integration tests verify route renders correctly
- [ ] #6 Integration tests verify OpenAPI spec is fetched and displayed
<!-- AC:END -->
