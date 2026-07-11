---
id: TASK-207
title: Emit request/response JSON schemas for the SSH & external OpenAPI routes
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-11 16:47'
updated_date: '2026-07-11 17:19'
labels:
  - bug
  - api
  - openapi
milestone: API bugs
dependencies: []
ordinal: 34014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The /api/v1/ssh/* and /api/v1/external/* Fastify routes register schemas with only tags+summary, so the generated OpenAPI (@fastify/swagger) has no requestBody and empty responses. As a result openapi-python-client can only build body-less requests with no typed models (discovered while updating pki-manager-cli). Attach the existing Zod schemas (trpc/ssh-schemas.ts and the inline bodies in external.routes.ts / ssh-external.routes.ts) to each route schema.body / schema.response via zod-to-json-schema, mirroring the X.509 routes, so REST/OpenAPI and tRPC stay a single source of truth.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Published openapi.json documents a request-body schema for every POST under /ssh/* and /external/* (e.g. POST /ssh/cas, /ssh/hosts, /ssh/hosts/issue, /ssh/users/issue, /ssh/tokens, /ssh/blocks, /external/sign, /external/revoke, /external/ssh/sign-host, /external/ssh/sign-user)
- [ ] #2 Published openapi.json documents a 200 response schema for those SSH and external routes
- [ ] #3 A client generated with openapi-python-client exposes typed body= parameters and return models for those endpoints (no body-less stubs)
<!-- AC:END -->
