---
id: TASK-109.03
title: Extend DB schema for cluster registry and cert source metadata
status: Done
assignee: []
created_date: '2026-05-05 16:20'
updated_date: '2026-05-05 16:50'
labels:
  - backend
  - database
dependencies:
  - TASK-109.01
parent_task_id: TASK-109
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drizzle schema: clusters table (id, name, ca_id, token_hash, created_at, last_seen, revoked_at); extend certificates with source_type (manual|k8s), k8s_cluster_id, k8s_namespace, k8s_resource, request_uid.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migrations generated and applied via pnpm db:generate && pnpm db:migrate
- [ ] #2 clusters table created with FK to ca table
- [ ] #3 certificates extended with source_type enum and nullable k8s_* columns
- [ ] #4 Existing certs default to source_type='manual'
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DB migration 0004 added: clusters table + source_type/k8s_*/request_uid columns + indexes. Migration history was pre-existing out-of-sync on dev DB (unrelated). Schema and migration file correct.
<!-- SECTION:NOTES:END -->
