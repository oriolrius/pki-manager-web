---
id: task-075
title: Implement Search and Utility REST endpoints
status: To Do
assignee: []
created_date: '2025-11-27 15:35'
labels:
  - openapi
  - backend
  - search
  - audit
dependencies:
  - task-069
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create REST endpoints for search, dashboard, and audit functionality:

- GET /api/v1/search - Global search
- GET /api/v1/domains - List domains
- GET /api/v1/dashboard/stats - Dashboard statistics
- GET /api/v1/dashboard/expiring - Expiring items
- GET /api/v1/audit - Audit log entries
- POST /api/v1/reports - Generate report

Reference: doc-005 (OpenAPI Specification Design)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All 6 utility endpoints implemented
- [ ] #2 Global search returns grouped results (cas, certificates, domains)
- [ ] #3 Dashboard stats endpoint returns real-time counts
- [ ] #4 Audit log supports filtering by operation, entity, status, date range
- [ ] #5 Report generation returns CSV with proper headers
<!-- AC:END -->
