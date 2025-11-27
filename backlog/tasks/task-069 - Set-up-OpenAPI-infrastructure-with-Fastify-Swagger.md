---
id: task-069
title: Set up OpenAPI infrastructure with Fastify Swagger
status: To Do
assignee: []
created_date: '2025-11-27 15:34'
labels:
  - openapi
  - backend
  - infrastructure
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Install and configure @fastify/swagger and @fastify/swagger-ui plugins to enable OpenAPI 3.1 specification generation and interactive documentation.

This is the foundational task for implementing the REST API layer alongside the existing tRPC implementation.

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @fastify/swagger and @fastify/swagger-ui packages installed
- [ ] #2 OpenAPI 3.1 configuration created in backend/src/rest/openapi.ts
- [ ] #3 Swagger UI accessible at /api/docs
- [ ] #4 REST routes registered under /api/v1 prefix
- [ ] #5 OpenAPI JSON spec available at /api/v1/openapi.json
<!-- AC:END -->
