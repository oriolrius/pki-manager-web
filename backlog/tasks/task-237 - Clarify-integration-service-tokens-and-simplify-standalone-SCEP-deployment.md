---
id: TASK-237
title: Clarify integration service tokens and simplify standalone SCEP deployment
status: In Progress
assignee:
  - '@codex'
created_date: '2026-10-22T09:55:00Z'
updated_date: '2026-10-22T09:55:00Z'
labels: []
dependencies: []
ordinal: 64014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose CA-bound external issuer credentials as integration service tokens usable by Kubernetes and SCEP, and document/run SCEP against an existing backend and KMS with exactly one additional service.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 UI labels describe integrations and service tokens without breaking existing API routes
- [ ] #2 Standalone SCEP Compose defines only a gateway using configurable existing backend and KMS endpoints
- [ ] #3 Setup documentation distinguishes backend upgrade from adding a second backend and includes provisioning and readiness checks
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Rename user-facing cluster registration and token labels to integrations/service tokens while preserving API compatibility.
2. Add standalone SCEP Compose against existing backend/KMS and document one-container provisioning.
3. Validate Compose service membership, focused frontend checks, SCEP image and live enrollment as feasible; report existing failures.
<!-- SECTION:PLAN:END -->
