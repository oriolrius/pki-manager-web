---
id: TASK-259
title: Publish the OpenAPI spec from the source at build time
status: Done
assignee:
  - '@claude'
created_date: '2026-11-24T09:15:00Z'
updated_date: '2026-11-24T10:47:00Z'
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
- [x] #1 API reference lists all REST endpoints of the current version
- [x] #2 The spec is generated in CI without a running prod instance
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- docs/site/scripts/openapi.mjs starts backend/src/server.ts briefly (empty temp DB, no OIDC/KMS, NODE_ENV=production), reads /api/v1/openapi.json, sets servers to https://pki.example.com/api/v1. No prod instance involved; CI installs the backend with pnpm.
- starlight-openapi 0.27.1 renders /api/reference/: 107 operations, one page each, with curl snippet, auth, body and responses, in the Pagefind search.
- Site moved to Node 22.23.5 so the backend (better-sqlite3 built for Node 22) and Astro (>=22.23.4) share one runtime.
<!-- SECTION:NOTES:END -->
